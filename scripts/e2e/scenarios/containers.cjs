// Remote → Containers with fakebin/docker: compose grouping, stop, open a shell in a container.
const fs = require('fs')
const path = require('path')

module.exports = async (h) => {
  const log = path.join(h.fixture, '..', 'docker.log')
  process.env.FAKE_DOCKER_LOG = log
  await h.openFixture()
  await h.click('.activitybar button[title^="Remote"]')
  await h.wait(500)
  h.expect(await h.click('.tabs button', 'Containers'), 'Containers tab exists under Remote')
  await h.wait(1500)
  h.expect(await h.js(`[...document.querySelectorAll('.rt-group-header span:first-of-type')].map(e => e.textContent).join() === 'shop,Standalone'`), 'containers grouped by compose project')
  h.expect(await h.js(`document.querySelector('[data-container="shop-web-1"] .rt-cmd')?.textContent.includes(':3000')`), 'published ports are shown')
  await h.shot('1-containers')

  h.expect(await h.click('[data-container="shop-db-1"] button[title="Stop"]'), 'stop button')
  await h.wait(1500)
  h.expect(fs.readFileSync(log, 'utf8').includes('stop bbbbbbbbbbbb'), 'stop runs docker stop with the container id')
  h.expect(await h.js(`!!document.querySelector('[data-container="shop-db-1"] button[title="Start"]')`), 'stopped container offers Start')

  h.expect(await h.click('[data-container="shop-web-1"] button[title="Open shell"]'), 'open shell button')
  await h.wait(1500)
  h.expect(fs.readFileSync(log, 'utf8').includes('exec -it aaaaaaaaaaaa'), 'shell runs docker exec -it in a terminal')
  await h.shot('2-shell')
}
