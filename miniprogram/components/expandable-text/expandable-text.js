Component({
  properties: {
    text: {
      type: String,
      value: '',
    },
    paragraphs: {
      type: Array,
      value: [],
    },
  },

  data: {
    content: '',
    expanded: false,
    showToggle: false,
  },

  observers: {
    'text, paragraphs'(text, paragraphs) {
      const rawText = String(text || '')
      const fallback = Array.isArray(paragraphs) ? paragraphs.join('') : ''
      const content = (rawText || fallback).replace(/[\r\n]+/g, '')
      this.setData({
        content,
        expanded: false,
        showToggle: false,
      }, () => this.refreshMeasurement())
    },
  },

  lifetimes: {
    attached() {
      this.refreshMeasurement()
    },
    detached() {
      this.measureVersion = (this.measureVersion || 0) + 1
    },
  },

  pageLifetimes: {
    resize() {
      this.refreshMeasurement()
    },
  },

  methods: {
    refreshMeasurement() {
      const version = (this.measureVersion || 0) + 1
      this.measureVersion = version
      return this.measureContent(version)
    },

    async measureContent(version) {
      const content = this.data.content
      if (!content) return
      const bounds = await this.measureBounds(version)
      if (!bounds || version !== this.measureVersion) return
      const [fullRect, collapsedRect] = bounds
      this.setData({ showToggle: fullRect.height > collapsedRect.height + 1 })
    },

    measureBounds(version) {
      return new Promise((resolve) => {
        wx.nextTick(() => {
          if (version !== this.measureVersion) {
            resolve(null)
            return
          }
          this.createSelectorQuery()
            .select('.expandable-text__measure--full').boundingClientRect()
            .select('.expandable-text__measure--collapsed').boundingClientRect()
            .exec((rects) => resolve(rects.length === 2 && rects.every(Boolean) ? rects : null))
        })
      })
    },

    toggleExpanded() {
      this.setData({ expanded: !this.data.expanded })
    },
  },
})
