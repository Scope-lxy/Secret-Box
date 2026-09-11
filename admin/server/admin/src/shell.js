(() => {
  const layout = document.querySelector('#adminLayout')
  const topbar = document.querySelector('.topbar')
  const breadcrumb = document.querySelector('#breadcrumbLabel')

  if (!layout || !topbar) return

  const compactButtons = [
    ['#manageAdminBtn', '账号设置'],
    ['#logoutBtn', '退出登录'],
  ]

  compactButtons.forEach(([selector, title]) => {
    document.querySelector(selector)?.setAttribute('title', title)
  })

  document.querySelectorAll('.section').forEach((section) => {
    const title = section.querySelector(':scope > h2')
    const hint = section.querySelector(':scope > .section-hint')
    const saveBar = section.querySelector(':scope > .save-bar')

    if (!title || !saveBar) return

    const head = document.createElement('div')
    head.className = 'section-page-head'

    const copy = document.createElement('div')
    copy.className = 'section-page-copy'

    section.insertBefore(head, title)
    head.appendChild(copy)
    copy.appendChild(title)
    if (hint) copy.appendChild(hint)

    saveBar.classList.add('save-bar--top')
    head.appendChild(saveBar)
  })

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.setAttribute('title', item.textContent.replace('●', '').trim())
    item.addEventListener('click', () => {
      document.querySelector('.content')?.scrollTo({ top: 0, behavior: 'smooth' })
      document.body.dataset.activeSection = item.dataset.section || ''
    })
  })

  document.querySelectorAll('[data-jump-section]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.jumpSection
      const navItem = document.querySelector(`.nav-item[data-section="${section}"]`)
      navItem?.click()
    })
  })

  const observer = new MutationObserver(() => {
    document.title = `${breadcrumb?.textContent || '后台'} · 轻读手记运营工作台`
  })

  if (breadcrumb) {
    observer.observe(breadcrumb, { childList: true, characterData: true, subtree: true })
  }
})()
