const changes = [];
window.chrome = { storage: { local: { get: async () => ({}) }, onChanged: { addListener: callback => changes.push(callback) } } };
window.setFixtureSettings = settings => changes.forEach(callback => callback({settings:{newValue:settings}},"local"));
window.sendFixtureRecords = records => window.postMessage({source:"x-follower-count",type:"FOLLOWER_COUNTS",records},location.origin);
