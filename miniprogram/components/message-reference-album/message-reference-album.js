Component({ properties: { item: { type: Object, value: {} } }, methods: { preview(event) { this.triggerEvent('preview', { imageIndex: Number(event.currentTarget.dataset.index || 0) }) } } })
