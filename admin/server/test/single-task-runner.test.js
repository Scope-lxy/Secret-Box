const assert = require('node:assert/strict')
const test = require('node:test')

const { TaskBusyError, createSingleTaskRunner } = require('../src/lib/single-task-runner')

test('single task runner rejects a concurrent task and releases after completion', async () => {
  const run = createSingleTaskRunner()
  let release
  const first = run(() => new Promise((resolve) => { release = resolve }))

  await assert.rejects(run(async () => {}), TaskBusyError)
  release('first complete')
  assert.equal(await first, 'first complete')
  assert.equal(await run(async () => 'next complete'), 'next complete')
})
