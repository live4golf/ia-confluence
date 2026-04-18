const CDP = require('chrome-remote-interface');
async function run() {
  const client = await CDP({ port: 9222, target: '7CC57DE01F78319EEF6502536AA0058B' });
  const { Page } = client;
  await Page.enable();
  const { data } = await Page.captureScreenshot({ format: 'png', quality: 100 });
  require('fs').writeFileSync('C:\\\\Users\\\\mark\\\\Documents\\\\AnitGravity\\\\Trading View\\\\chart_screenshot.png', Buffer.from(data, 'base64'));
  console.log('Screenshot saved');
  await client.close();
}
run().catch(console.error);
