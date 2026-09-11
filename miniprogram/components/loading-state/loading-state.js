Component({
  properties: {
    rows: { type: Number, value: 3, observer: 'buildRows' },
    rowWidth: { type: String, value: '', observer: 'buildRows' },
    label: { type: String, value: '正在加载' },
  },

  data: { rowItems: [] },

  lifetimes: {
    attached() { this.buildRows() },
  },

  methods: {
    buildRows() {
      const count = Math.max(1, Math.min(8, Number(this.data.rows || this.properties.rows) || 3))
      const widths = String(this.data.rowWidth || this.properties.rowWidth || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      const rowItems = Array.from({ length: count }, (_, index) => ({
        width: widths[index] || widths[widths.length - 1] || '100%',
      }))
      this.setData({ rowItems })
    },
  },
})
