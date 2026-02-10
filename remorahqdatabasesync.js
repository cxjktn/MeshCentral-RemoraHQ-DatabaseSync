const SUPPORTED_DB_TYPES = ['mssql', 'postgres', 'mysql']

module.exports.remorahqdatabasesync = function (parent) {
  const obj = {}

  obj.pluginid = 'remorahqdatabasesync'
  obj.version = '0.1.1'
  
  const pluginConfig = parent.config.plugins
    ? parent.config.plugins[obj.pluginid] || {}
    : {}

  function log (...args) {
    parent.debug(1, 'RemoraHQ-DatabaseSync:', ...args)
  }

  const state = {
    databases: (pluginConfig.databases || []).map((db) => ({
      id: db.id,
      type: db.type,
      hasConnectionString: !!db.connectionString,
      lastStatus: 'unknown',
      lastError: null,
      lastMetrics: null,
    })),
  }
  
  async function probeDatabase (dbConfig) {
    return {
      ok: true,
      metrics: {
        connections: Math.floor(Math.random() * 50),
        cpuPercent: Math.round(Math.random() * 80),
        queriesPerSecond: Math.round(Math.random() * 1000) / 10,
      },
    }
  }

  function handleControlMessage (user, ws, message) {
    if (!message || message.action !== 'dbsync') return false

    const sub = message.sub
    const response = {
      action: 'dbsync',
      sub,
      responseid: message.responseid,
      sessionid: message.sessionid,
    }

    if (sub === 'list') {
      response.result = 'ok'
      response.databases = state.databases
      try { ws.send(JSON.stringify(response)) } catch (e) { }
      return true
    }

    if (sub === 'probe') {
      const id = message.id
      const db = state.databases.find((x) => x.id === id)
      if (!db) {
        response.result = 'notfound'
        try { ws.send(JSON.stringify(response)) } catch (e) { }
        return true
      }
      
      probeDatabase(db)
        .then((res) => {
          db.lastStatus = res.ok ? 'online' : 'error'
          db.lastError = res.ok ? null : (res.error || 'Unknown error')
          db.lastMetrics = res.metrics || null

          response.result = res.ok ? 'ok' : 'error'
          response.metrics = res.metrics || null
          response.error = res.error || null
          try { ws.send(JSON.stringify(response)) } catch (e) { }
        })
        .catch((err) => {
          db.lastStatus = 'error'
          db.lastError = err.message
          db.lastMetrics = null

          response.result = 'error'
          response.error = err.message
          try { ws.send(JSON.stringify(response)) } catch (e) { }
        })

      return true
    }

    response.result = 'unsupported'
    try { ws.send(JSON.stringify(response)) } catch (e) { }
    return true
  }

  obj.start = function () {
    if (!pluginConfig.enabled) {
      log('disabled in config, skipping init')
      return
    }

    if (!Array.isArray(pluginConfig.databases) || pluginConfig.databases.length === 0) {
      log('no databases configured in plugins.remorahq-databasesync.databases')
    } else {
      const invalid = pluginConfig.databases.filter(
        (db) => !SUPPORTED_DB_TYPES.includes(db.type),
      )
      if (invalid.length) {
        log('warning: some databases have unsupported type:', invalid)
      }
      log('loaded databases from config:', pluginConfig.databases.map((d) => d.id).join(', '))
    }

    if (parent.addServerDispatchHook) {
      parent.addServerDispatchHook('dbsync', handleControlMessage)
    } else if (parent.DispatchEvent) {
      const oldHandler = parent.onControlMessage
      parent.onControlMessage = function (user, ws, message) {
        if (handleControlMessage(user, ws, message) === true) return
        if (typeof oldHandler === 'function') oldHandler(user, ws, message)
      }
    }

    log('started, version', obj.version)
  }

  obj.stop = function () {
    log('stopped')
  }

  obj.server_startup = obj.start
  obj.server_shutdown = obj.stop

  return obj
}

