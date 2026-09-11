const assert = require('node:assert/strict')
const test = require('node:test')

const { createHistoryAudioPlayer } = require('../../../miniprogram/utils/history-audio')

function createPage(items) {
  return {
    data: { items },
    setData(updates) {
      Object.entries(updates).forEach(([key, value]) => {
        const match = key.match(/^items\[(\d+)\]\.(.+)$/)
        if (match) this.data.items[Number(match[1])][match[2]] = value
      })
    },
  }
}

function createAudioContext() {
  const handlers = {}
  return {
    autoplay: true,
    currentTime: 0,
    duration: 28,
    playCalls: 0,
    pauseCalls: 0,
    seekCalls: [],
    stopCalls: 0,
    set src(value) {
      this.currentTime = 0
      this.source = value
    },
    onCanplay(callback) { handlers.canplay = callback },
    onPlay(callback) { handlers.play = callback },
    onPause(callback) { handlers.pause = callback },
    onWaiting(callback) { handlers.waiting = callback },
    onTimeUpdate(callback) { handlers.timeUpdate = callback },
    onEnded(callback) { handlers.ended = callback },
    onError(callback) { handlers.error = callback },
    play() { this.playCalls += 1; handlers.play?.() },
    pause() { this.pauseCalls += 1; handlers.pause?.() },
    stop() { this.stopCalls += 1 },
    seek(seconds) { this.currentTime = seconds; this.seekCalls.push(seconds) },
    destroy() {},
    emit(name) { handlers[name]?.() },
  }
}

test('history audio uses one streaming context and restores each card progress', () => {
  const originalWx = global.wx
  const context = createAudioContext()
  global.wx = {
    createInnerAudioContext() { return context },
    showToast() {},
  }

  const page = createPage([
    {
      id: 'audio-1',
      isAudio: true,
      audioUrl: 'https://cos.example.com/audio-1.m4a',
      durationSeconds: 28,
      audioCurrentSeconds: 0,
      audioCurrentTime: '00:00',
      audioIsPlaying: false,
      audioIsBuffering: false,
    },
    {
      id: 'audio-2',
      isAudio: true,
      audioUrl: 'https://cos.example.com/audio-2.m4a',
      durationSeconds: 28,
      audioCurrentSeconds: 0,
      audioCurrentTime: '00:00',
      audioIsPlaying: false,
      audioIsBuffering: false,
    },
  ])

  try {
    const player = createHistoryAudioPlayer(page, 'items')
    player.toggle('audio-1')
    assert.equal(context.autoplay, false)
    assert.equal(context.source, 'https://cos.example.com/audio-1.m4a')
    assert.equal(page.data.items[0].audioIsPlaying, true)

    context.currentTime = 7
    context.emit('timeUpdate')
    assert.equal(page.data.items[0].audioCurrentTime, '00:07')

    player.toggle('audio-2')
    assert.equal(page.data.items[0].audioIsPlaying, false)
    assert.equal(context.source, 'https://cos.example.com/audio-2.m4a')

    player.toggle('audio-1')
    context.emit('canplay')
    assert.equal(context.seekCalls.at(-1), 7)
    assert.equal(page.data.items[0].audioCurrentTime, '00:07')
    player.destroy()
  } finally {
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
})
