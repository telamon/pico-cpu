import { Repo } from 'picorepo'
import test from 'tape'
import { MemoryLevel } from 'memory-level'
import {
  CPU,
  DNUM,
  OP_INC,
  OP_DEC,
  DSET,
  OP_ADD,
  OP_DEL,
  mkPUID,
  Layer
} from './index.js'
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto) globalThis.crypto = webcrypto

const mkRepo = () => new Repo(new MemoryLevel('cpu.lvl', {
  keyEncoding: 'buffer',
  valueEncoding: 'buffer'
}))

test('Last 2023Q2 Attempt', async t => {
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
    state.instr('x', DNUM, OP_INC, 1)
    state.instr('x', DNUM, OP_INC, 6)
    state.instr('x', DNUM, OP_DEC, 2)
    // Array/UnorderedSet

    state.instr('peers', DSET, OP_ADD, mkPUID(), 'alice')
    state.instr('peers', DSET, OP_ADD, mkPUID(), 'bob')
    const cid = mkPUID()
    state.instr('peers', DSET, OP_ADD, cid, 'charlie')
    state.instr('peers', DSET, OP_DEL, cid)
    // state.instr('peers.3', DMAP, 'set', 'power', 4)
    // state.instr('peers.3.speed', DNUM, 'inc', 10)
  })
  // console.log(cpuA.state)
  t.equal(cpuA.state.x.value, 5, 'X was altered')
  t.deepEqual(cpuA.state.peers.value, ['alice', 'bob'])

  const merged = await cpuB.merge(layer)
  t.equal(merged.length, 1, 'Layers merged')
  t.equal(cpuB.state.x.value, 5, 'X was altered')
  t.deepEqual(cpuB.state.peers.value, ['alice', 'bob'])

  const inv = Layer.from(merged.last).reverse()
  // console.log('Inverse OPS', inv.ops)
  inv.apply(cpuA.state)
  t.equal(cpuA.state.x.value, 0, 'x is 0')
  t.deepEqual(cpuA.state.peers.value, [], 'peers emptied')
})
// ---------- GPT REFINEMENT WORKBENCH
