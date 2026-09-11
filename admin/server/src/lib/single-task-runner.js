class TaskBusyError extends Error {
  constructor() {
    super('任务正在处理中')
    this.name = 'TaskBusyError'
  }
}

function createSingleTaskRunner() {
  let running = false
  return async function run(task) {
    if (running) throw new TaskBusyError()
    running = true
    try {
      return await task()
    } finally {
      running = false
    }
  }
}

module.exports = {
  TaskBusyError,
  createSingleTaskRunner,
}
