// SPDX-License-Identifier: AGPL-3.0-or-later
import { Feed } from 'picofeed'
import { decode, encode } from 'cbor-x'

export const [
  DMAP,
  DSET,
  DNUM
  // DSTR
] = [0, 1, 2, 3]
// For GC@expiredAt; Ops need to be reversible
// DNUM OPS
export const OP_INC = 10
export const OP_DEC = ~OP_INC
// DSET
export const OP_ADD = 11
export const OP_DEL = ~OP_ADD
// DMAP
export const OP_SET = 12
export const OP_UST = ~OP_SET

/**
 * @typedef {number} PUID
 * @returns {PUID} A 24bit random number
 */
export function mkPUID () {
  const b = new Uint8Array(4)
  globalThis.crypto.getRandomValues(b)
  return (b[2] << 16) | (b[1] << 8) | b[0]
}

export class CRDTNumber {
  inc = 0
  dec = 0
  constructor (v = 0) { this.value = v }
  get value () { return this.inc - this.dec }
  set value (n) {
    const d = n - (this.inc - this.dec)
    if (n > this.value) this.inc += d
    else this.dec += d
  }
}

export class CRDTArray {
  vals = []
  /** @type {Set<PUID>} */
  pids = new Set()
  /** @type {Set<PUID>} */
  tomb = new Set()
  constructor (values = []) {
    if (!Array.isArray(values)) throw new Error('ArrayExpected')
    for (const v of values) this.push(mkPUID(), v)
  }

  /**
   * @param {PUID} pid
   * @param {el?} Any
   */
  push (pid, el) {
    if (this.pids.has(pid)) {
      if (this.tomb.delete(pid)) return undefined
      else throw new Error('ObjectAlreadyExists')
    }
    this.pids.add(pid)
    this.vals.push(el)
    // TODO: return this.length
  }

  delete (pid) { this.tomb.add(pid) }

  get value () {
    const lut = Array.from(this.pids)
    return this.vals.filter((_, i) => !this.tomb.has(lut[i]))
  }

  get length () { return this.value.length }
  // [Symbol.iterator] () { }
}

export class Layer {
  date = Date.now()
  ops = [] // <-- yes { p: 'x', op: 'inc', a0: 3 }
  signature = null // <-- when set, mutations frozen.
  // expiresAt = (...) => boolean

  /**
   * @param {string} path Location in root DMAP
   * @param {number} type Expected DObject Type
   * @param {number} op Operation ID
   * @param {any} a1 Operation Argument1
   * @param {any} a1 Operation Argument2
   */
  instr (path, type, op, a1, a2 = null) {
    if (a2 !== null) this.ops.push([path, type, op, a1, a2])
    else this.ops.push([path, type, op, a1])
  }

  reverse () {
    const l = new Layer()
    l.ops = this.ops.map(i => {
      const r = [...i]
      r[2] = ~r[2] // All inverse ops are bitflip defined
      return r
    }).reverse()
    return l
  }

  apply (o) {
    for (const [path, type, op, arg1, arg2] of this.ops) {
      let target = o
      const segments = path.split('.')
      while (target && segments.length > 1) {
        const cd = segments.shift()
        target = target[cd]
      }
      const prop = segments.shift()
      switch (type) {
        case DNUM:
          target[prop] = target[prop] || new CRDTNumber()
          if (!(target[prop] instanceof CRDTNumber)) throw new Error('PropIsNotANumber')
          if (op === OP_INC) target[prop].inc += arg1
          else if (op === OP_DEC) target[prop].dec += arg1
          else throw new Error('DNUM:InvalidInstruction:' + op)
          break
        case DSET:
          target[prop] = target[prop] || new CRDTArray()
          if (!(target[prop] instanceof CRDTArray)) throw new Error('PropIsNotArray')
          if (op === OP_ADD) target[prop].push(arg1, arg2)
          else if (op === OP_DEL) target[prop].delete(arg1)
          else throw new Error('DSET:InvalidInstruction:' + op)
          break
        case DMAP:
          target[prop] = target[prop] || {}
          if (op === OP_SET) target[prop][arg1] = arg2
          else if (op === OP_UST) delete target[prop][arg1]
          else throw new Error('DMAP:InvalidInstruction:' + op)
          break
        default:
          throw new Error('UnknownType:' + type)
      }
    }
  }

  toFeed (sk, branch = new Feed()) {
    branch.append(encode({ d: this.date, i: this.ops }), sk)
    this.signature = branch.last.sig
    // Object.freeze(this) // ?
    return branch.last
  }

  static from (block) {
    const j = decode(block.body)
    const l = new Layer()
    l.date = j.d
    l.ops = Object.freeze(j.i)
    l.signature = block.sig
    return Object.freeze(l)
  }
}

export class CPU {
  layers = []
  state = {}

  /**
   * Creates a new PicoCPU
   * @param {Repo} repo A pico-repository
   */
  constructor (repo) {
    this.repo = repo
    this._sk = Feed.signPair().sk
  }

  async restore () {
    // TODO: load state from this.repo
  }

  /**
   * Creates a layer that
   * that alters state
   * @param {(state: Layer) => Promise<void>} callback Interface to mutate state
   * @return Feed a feed containing the binary layer.
   */
  async mutate (callback) {
    const layer = new Layer()
    // const screen = this._proxyFor('/', layer)
    await callback(layer)
    return this.merge(layer.toFeed(this._sk))
  }

  /**
   * @returns {Promise<Feed>} returns a feed with applied blocks
   */
  async merge (feed) { // Equals CPU-RUN/STEP
    feed = Feed.from(feed)
    for (const block of feed.blocks) {
      const layer = Layer.from(block)
      layer.apply(this.state) // Naive approach
      this.layers.push(layer)
    }
    return feed
  }

  /** @type {path: string, writable: Layer} */
  /*
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
  */
}
