export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL ?? 'http://localhost:3211',
      applicationID: 'convex',
    },
  ],
}
