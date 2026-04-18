const CDP = require('chrome-remote-interface');

async function run() {
  const targets = await CDP.List({ port: 9222 });
  const chartPage = targets.find(t => t.url && t.url.includes('tradingview.com/chart'));
  const client = await CDP({ port: 9222, target: chartPage.id });
  const { Runtime, Page } = client;
  await Runtime.enable();
  await Page.enable();

  // Zoomed trade list — full height, 2.5x
  const { data: d1 } = await Page.captureScreenshot({ format: 'png', clip: { x: 60, y: 200, width: 460, height: 560, scale: 2.5 } });
  require('fs').writeFileSync('C:\\Users\\mark\\Documents\\AnitGravity\\Trading View\\trades_full.png', Buffer.from(d1, 'base64'));

  // Chart showing price action (main area)
  const { data: d2 } = await Page.captureScreenshot({ format: 'png', clip: { x: 460, y: 50, width: 820, height: 670, scale: 1.5 } });
  require('fs').writeFileSync('C:\\Users\\mark\\Documents\\AnitGravity\\Trading View\\chart_action.png', Buffer.from(d2, 'base64'));

  console.log('Done');
  await client.close();
}
run().catch(console.error);
