(function exposeFolderImportFiles(root) {
  const ignored = (path) => String(path || '').split(/[\\/]/).some((part) => part.startsWith('.') || ['node_modules', '__MACOSX'].includes(part))

  function collector({ accept = () => true, validate = () => {}, emptyMessage = '没有找到当前类型支持的文件' } = {}) {
    const records = [], paths = new Set()
    let skipped = 0, totalBytes = 0
    return {
      skip() { skipped++ },
      accepts(path) { return !ignored(path) && accept({ name: path.split('/').pop(), path }) },
      add(file, relativePath) {
        const path = String(relativePath || file.webkitRelativePath || file.name).replace(/\\/g, '/')
        const record = { file, name: file.name, path, size: file.size }
        if (ignored(path) || !accept(record)) { skipped++; return }
        if (paths.has(path)) throw new Error('重复选择了同一路径：' + path)
        validate(record, records.length + 1, totalBytes + file.size)
        paths.add(path)
        records.push(record)
        totalBytes += file.size
      },
      result() {
        if (!records.length) throw new Error(emptyMessage + '；已跳过 ' + skipped + ' 个无关文件或辅助目录')
        records.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true }))
        return { records, skipped, totalBytes }
      },
    }
  }

  function fromFiles(files, options) {
    const output = collector(options)
    for (const file of Array.from(files || [])) output.add(file)
    return output.result()
  }

  async function fromDrop(dataTransfer, options) {
    // The browser only exposes the entries while the drop event owns its data store.
    const entries = Array.from(dataTransfer?.items || []).map((item) => item.webkitGetAsEntry?.()).filter(Boolean)
    if (!entries.length) throw new Error('当前浏览器不支持拖入文件夹，请点击“选择文件夹”')
    if (!entries.some((entry) => entry.isDirectory)) throw new Error('请拖入文件夹；单独的文件请使用右上角的选择入口')
    const output = collector(options)
    async function visit(entry, parent = '') {
      const path = parent + entry.name
      if (ignored(path)) { output.skip(); return }
      try {
        if (entry.isFile) {
          if (!output.accepts(path)) { output.skip(); return }
          const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
          output.add(file, path)
        } else if (entry.isDirectory) {
          const reader = entry.createReader()
          // Chromium returns at most 100 children per call; keep reading until empty.
          for (;;) {
            const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
            if (!batch.length) break
            for (const child of batch) await visit(child, path + '/')
          }
        }
      } catch (error) {
        if (error.name === 'NotReadableError' || error.name === 'NotFoundError' || error.name === 'SecurityError') {
          throw new Error('无法读取 ' + path + '，请检查文件权限后重新选择')
        }
        throw error
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory) await visit(entry)
      else output.skip()
    }
    return output.result()
  }

  const api = { fromFiles, fromDrop }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.FolderImportFiles = api
})(typeof window !== 'undefined' ? window : globalThis)
