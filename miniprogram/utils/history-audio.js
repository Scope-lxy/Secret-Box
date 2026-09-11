function formatAudioTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function createHistoryAudioPlayer(page, listKey) {
  let context = null
  let activeId = ''
  let source = ''
  let pendingSeek = null

  function getItem(id) {
    return (page.data[listKey] || []).find((item) => item.id === id) || null
  }

  function updateItem(id, values) {
    const index = (page.data[listKey] || []).findIndex((item) => item.id === id)
    if (index < 0) return
    const updates = {}
    Object.keys(values).forEach((key) => {
      updates[`${listKey}[${index}].${key}`] = values[key]
    })
    page.setData(updates)
  }

  function syncProgress(id, currentTime, duration) {
    const item = getItem(id)
    if (!item) return
    const durationSeconds = Math.max(0, Number(duration) || Number(item.durationSeconds) || 0)
    const currentSeconds = durationSeconds
      ? Math.min(Math.max(0, Number(currentTime) || 0), durationSeconds)
      : Math.max(0, Number(currentTime) || 0)
    const progress = durationSeconds ? (currentSeconds / durationSeconds) * 100 : 0
    updateItem(id, {
      durationSeconds,
      audioCurrentSeconds: currentSeconds,
      audioCurrentTime: formatAudioTime(currentSeconds),
      audioProgressStyle: `width: ${progress}%;`,
    })
  }

  function setPlaying(id, isPlaying, isBuffering = false) {
    updateItem(id, { audioIsPlaying: isPlaying, audioIsBuffering: isBuffering })
  }

  function setupContext() {
    if (context || !wx.createInnerAudioContext) return
    context = wx.createInnerAudioContext()
    context.autoplay = false
    context.onCanplay(() => {
      if (!activeId) return
      const item = getItem(activeId)
      if (!item) return
      if (pendingSeek?.id === activeId) {
        const seconds = Math.min(Math.max(0, pendingSeek.seconds), Number(context.duration) || item.durationSeconds || 0)
        if (seconds) context.seek(seconds)
        pendingSeek = null
      }
      syncProgress(activeId, context.currentTime, context.duration)
      setPlaying(activeId, item.audioIsPlaying, false)
    })
    context.onPlay(() => {
      if (activeId) setPlaying(activeId, true, false)
    })
    context.onPause(() => {
      if (activeId) setPlaying(activeId, false)
    })
    context.onWaiting(() => {
      if (activeId) updateItem(activeId, { audioIsBuffering: true })
    })
    context.onTimeUpdate(() => {
      if (activeId) syncProgress(activeId, context.currentTime, context.duration)
    })
    context.onEnded(() => {
      if (!activeId) return
      const item = getItem(activeId)
      if (!item) return
      const durationSeconds = Math.max(0, Number(context.duration) || Number(item.durationSeconds) || 0)
      syncProgress(activeId, durationSeconds, durationSeconds)
      setPlaying(activeId, false)
    })
    context.onError(() => {
      if (!activeId) return
      setPlaying(activeId, false)
      wx.showToast({ title: '音频暂时无法播放', icon: 'none' })
    })
  }

  function ensureSource(item) {
    const url = String(item.audioUrl || '').trim()
    if (!url) {
      wx.showToast({ title: '音频地址暂不可用', icon: 'none' })
      return false
    }
    setupContext()
    if (!context) return false
    if (source !== url) {
      context.stop()
      pendingSeek = { id: item.id, seconds: Number(item.audioCurrentSeconds) || 0 }
      context.src = url
      source = url
    }
    return true
  }

  return {
    toggle(id) {
      const item = getItem(id)
      if (!item || !item.isAudio) return
      if (activeId === id && item.audioIsPlaying) {
        context?.pause()
        return
      }
      if (!ensureSource(item)) return
      const previousId = activeId
      activeId = id
      if (previousId && previousId !== id) setPlaying(previousId, false)
      if (item.durationSeconds && item.audioCurrentSeconds >= item.durationSeconds) {
        context.seek(0)
        syncProgress(id, 0, item.durationSeconds)
      }
      context.play()
    },

    pause() {
      context?.pause()
    },

    reset() {
      context?.stop()
      activeId = ''
      source = ''
      pendingSeek = null
    },

    destroy() {
      if (!context) return
      context.stop()
      context.destroy()
      context = null
      activeId = ''
      source = ''
      pendingSeek = null
    },
  }
}

module.exports = {
  createHistoryAudioPlayer,
}
