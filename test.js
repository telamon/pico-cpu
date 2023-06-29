import test from 'tape'
import { Feed } from 'picofeed'
import { Repo } from 'picorepo'
import { MemoryLevel } from 'memory-level'
const mkRepo = () => new Repo(new MemoryLevel('cpu.lvl', {
  keyEncoding: 'buffer',
  valueEncoding: 'buffer'
}))
test('desc', async t => {
  const cpu = new PicoCPU()

  cpu.defineNumber('x', 3) // Or maybe 'increment'
  await cpu.restore()
  t.equal(cpu.state.x, 3)

  const stage = cpu.createStage()
  stage.update('x', 7)
  stage.inspect()
  const { sk } = Feed.signPair()
  const forkA = new Feed()
  const patch = await stage.commit(forkA, sk)
  t.equal(cpu.state.x, 3)
  patch.inspect()
})

test.skip('list when depression hits', async t => {
  // Create CPU when everything feels meaningless
  const cpu = new PicoCPU() // It's not designed to work.
  const friends = cpu.defineList('friends') // greater than zero but what's the point?
  cpu.defineList('bitches') // Tinder sux, gf sux good but gf is gf.

  // Where is the magnetic tape supposed to go???
  // there's like My picofeed where shit might get recorded
  // or like a shitty game.
  // FUUUUK I Need to ventilate. i've been holding my shit in for
  // so long. SOOO FUCKING long. LOVE SUCKS
  // LOVE SUCKS SO FUCKING MUCH
})

test.skip('instruction set approach', async t => {
  // define a model, set script boundaries
  // a single bucket as fixture
  const bucket = [
    {
      text: 'World Peace Please',
      date: 0,
      ttl: 65, // Highlevel GC hint. 60 mins
      bumps: 0 // n-likes/bumps
    }
  ]
  const cpu = new PicoCPU()
  await cpu.restore()

  const stage = cpu.createStage()
  stage.defineNumber('x', 3)
  stage.incNumber('x', 9)
  const { sk: skA } = Feed.signPair()
  const feed = await stage.commit(skA)
  feed.inspect()
})

class PicoCPU {
  vars = {}
  // constructor (ldb) {}
  defineNumber (name, inititalValue = 0) {
    this.vars[name] = new CRDTNumber(inititalValue)
  }

  get state () {
    const snapshot = {}
    for (const key in this.vars) snapshot[key] = this.vars[key].value
    return snapshot
  }

  createStage () {
    return new StagingArea(this)
  }

  async restore () { /* TODO: restore state from ldb */ }

  async run (feed) {
    console.log('CPU:run')
    feed.inspect()
  }
}

class CRDTNumber {
  static TYPE = 0
  increment = 0
  decrement = 0
  // multiplier = 1
  // divisor = 1
  constructor (inititalValue = 0) {
    if (inititalValue < 0) this.decrement = -inititalValue
    else this.increment = inititalValue
  }

  get value () {
    return (this.increment - this.decrement) //  * this.multiplier / this.divisor
  }

  clone () {
    const c = new CRDTNumber()
    c.increment = this.increment
    c.decrement = this.decrement
    return c
  }

  pack () {
    return [this.increment, this.decrement]
  }

  static unpack (arr) {
    const [i, d] = arr
    const c = new CRDTNumber()
    c.increment = i
    c.decrement = d
    return c
  }
}

class StagingArea {
  vars = {}
  date = Date.now()
  status = 'pending'

  constructor (root) {
    this.root = root
  }

  update (name, value) {
    let vr = this.vars[name]
    if (!vr && !this.root.vars[name]) throw new Error(`No such variable: ${name}`)
    else if (!vr) vr = this.vars[name] = this.root.vars[name].clone()

    if (vr instanceof CRDTNumber) {
      if (!Number.isFinite(value)) throw new Error(`Expected number, found: ${value}`)
      if (vr.value < value) vr.increment += value - vr.value
      else if (vr.value > value) vr.decrement += value - vr.value
    }
  }

  async commit (feed, secret) {
    const body = { d: Date.now() }
    for (const key in this.vars) {
      const vr = this.vars[key]
      body[key] = [vr.constructor.TYPE, vr.pack()]
    }
    console.log(JSON.stringify(body))
    feed.append(JSON.stringify(body), secret) // TODO: mpacker
    await this.root.run(feed)
    this.status = 'merged'
  }

  inspect () {
    let str = `Patch ${this.date} [${this.status}]\n`
    for (const key in this.vars) {
      str += `V: ${this.root.vars[key].value} => ${this.vars[key].value}`
    }
    console.log(str)
  }
}

test.only('Last 2023Q2 Attempt', async t => {
  const cpuA = new CPU(mkRepo(), {
    root: {} // Auto new DMap()
  })
  await cpuA.restore()

  const cpuB = new CPU(mkRepo())
  await cpuB.restore()

  // Attempt to mutate state
  const layer = await cpuA.mutate(state => {
    // Proxy Based API - Learn to walk before run
    // state.x = 0
    // t.equal(state.x, 0)
    // state.x += 5
    // t.equal(state.x, 5)

    // Instruction vocabulary
    layer.instr('x:n', 'inc', 1)
    layer.instr('x:n', 'inc', 6)
    layer.instr('x:n', 'dec', 1)
    layer.instr('peers:a', 'push', 'alice')
    layer.instr('peers:a', 'push', 'bob')
    layer.instr('peers:a', 'push', 'charlie')
  })
  t.equal(cpuA.get('x'), 2, 'Readable outside of mutation')
  const merged = await cpuB.merge(layer)
  t.equal(merged, 1, 'Layers merged')
  t.equal(cpuB.get('x'), 2, 'State replicated')
})

/** @typedef {{ root: object }} PicoCPUOptions */
class CPU {
  layers = []
  state = {}
  /**
   * Creates a new PicoCPU
   * @param {Repo} repo A pico-repository
   * @param {PicoCPUOptions} opts
    */
  constructor (repo) {
    this.repo = repo
  }

  async restore () {
    // TODO: load state from this.repo
  }

  /**
   * Creates a layer that
   * that alters state
   * @param {async (state: Layer) => void} callback Interface to mutate state
   * @return Feed a feed containing the binary layer.
   */
  async mutate (callback) {
    const layer = new Layer()
    const screen = this._proxyFor('/', layer)
    await callback(screen)
    return layer.toFeed()
  }

  /** @type {path: string, writable: Layer} */
  _proxyFor (path, writable) {
    const segments = path.replace(/^\//, '').split('/')
    let target = this.state
    while (target && segments.length) {
      const s = segments.shift()
      if (s.length) target = target[s]
    }
    if (!target) throw new Error('TargetNotFound')

    return new Proxy(target, {
      get (target, prop) {
        debugger
      },
      set (target, prop, value) {
        if (!writable) return false
        debugger
      }
    })
  }
}

class Layer {
  mutations = [] // <-- yes { p: 'x', op: 'inc', a0: 3 }
  signature = null // <-- when set, mutations frozen.
}

class DObj {
  get value () { return this._value }
}

class DMap extends DObj {
  _value = new Map()
  constructor (defaultValue = {}) {
    super()
    for (const key in defaultValue) this._value.put(key, defaultValue[key])
  }

  /**
   * Returns value for key
   * @param {string} key
   * @param {'number'|'map'|'set'} defaultType the expected
   * @param {any} defaultValue the DObject value return when key dosen't exist
   */
  get (key, defaultType, defaultValue) {
    if (defaultType && this._value.has(key)) this._value.put(key, decentralize(defaultType, defaultValue))
    this._value.get(key)
  }
}
