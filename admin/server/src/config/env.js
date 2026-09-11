const configuredNodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase()
const env = {
  nodeEnv: configuredNodeEnv || 'development',
  productionLike: !['development', 'test'].includes(configuredNodeEnv || 'development'),
  port: Number(process.env.PORT || 3000),
  corsOrigin: String(process.env.CORS_ORIGIN || '').trim() || (['development', 'test'].includes(configuredNodeEnv) ? '*' : ''),
  trustedProxy: process.env.TRUSTED_PROXY || '',
  cos: {
    secretId: process.env.COS_SECRET_ID || '',
    secretKey: process.env.COS_SECRET_KEY || '',
    bucket: process.env.COS_BUCKET || '',
    region: process.env.COS_REGION || '',
  },
  databaseUrl: process.env.DATABASE_URL || '',
}

module.exports = {
  env,
}
