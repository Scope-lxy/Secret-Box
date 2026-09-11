const accountPolicy = {
  primaryIdentity: 'unionid',
  fallbackIdentity: 'phone',
  localIdentity: 'openid',
  internalAccountKey: 'accountId',
  mergeStrategy: 'unionid-first-phone-fallback',
  conflictStrategy: 'last-write-wins-with-updatedAt',
}

module.exports = {
  accountPolicy,
}