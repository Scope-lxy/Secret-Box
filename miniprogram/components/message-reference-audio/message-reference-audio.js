Component({ properties: { item: { type: Object, value: {} } }, methods: { toggle() { this.triggerEvent('toggle', { id: this.data.item.id }) } } })
