(function exposeDocumentFiles(root) {
  const folderFiles = typeof module !== 'undefined' && module.exports ? require('./folder-import-files') : root.FolderImportFiles
  const supported = /\.(?:md|markdown|txt)$/i
  const limits = { files: 200, fileBytes: 1024 * 1024, totalBytes: 20 * 1024 * 1024, chunkBytes: 2 * 1024 * 1024 }
  const options = {
    accept: (record) => supported.test(record.path),
    emptyMessage: '没有找到 MD、Markdown 或 TXT 文章文件',
    validate(record, count, totalBytes) {
      if (record.size > limits.fileBytes) throw new Error(record.path + ' 超过单文件 1MB 限制')
      if (count > limits.files) throw new Error('发现超过 200 份文章，请选择较小的账号目录或分批选择；本次未提交任何文件')
      if (totalBytes > limits.totalBytes) throw new Error('原始文件合计超过 20MB，请分批选择')
    },
  }
  function fromFiles(files) {
    return folderFiles.fromFiles(files, options)
  }
  function fromDrop(dataTransfer) {
    return folderFiles.fromDrop(dataTransfer, options)
  }
  function chunks(records) {
    const result = []
    let group = [], bytes = 0
    for (const record of records) {
      if (group.length && (bytes + record.size > limits.chunkBytes || group.length >= 20)) { result.push(group); group = []; bytes = 0 }
      group.push(record)
      bytes += record.size
    }
    if (group.length) result.push(group)
    return result
  }
  const api = { fromFiles, fromDrop, chunks, limits }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.ArticleDocumentFiles = api
})(typeof window !== 'undefined' ? window : globalThis)
