Component({
  properties: {
    row: { type: Number, value: 3, observer: 'buildRows' },
    rowWidth: { type: String, value: '', observer: 'buildRows' },
    animate: { type: Boolean, value: false },
  },

  data: { rows: [] },

  lifetimes: {
    attached() { this.buildRows() },
  },

  methods: {
    buildRows() {
      const count = Math.max(1, Math.min(12, Number(this.data.row || this.properties.row) || 3))
      const widths = String(this.data.rowWidth || this.properties.rowWidth || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      const rows = Array.from({ length: count }, (_, index) => ({
        width: widths[index] || widths[widths.length - 1] || '100%',
      }))
      this.setData({ rows })
    },
  },
})
