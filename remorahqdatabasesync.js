var MongoClient = null
try { MongoClient = require('mongodb').MongoClient } catch (e) { }

var Database = null
try { Database = require('better-sqlite3') } catch (e) { }

var os = require('os')
var fs = require('fs')
var path = require('path')

module.exports.remorahqdatabasesync = function (parent) {
  var obj = {}

  obj.pluginid = 'remorahqdatabasesync'
  obj.version = '0.3.8'
  obj.hasAdminPanel = true

  var settingsDb = null
  var settingsDbPath = null
  
  if (parent && parent.parent && parent.parent.datapath) {
    var pluginPath = path.join(parent.parent.datapath, 'plugins', 'remorahqdatabasesync')
    if (fs.existsSync(pluginPath)) {
      settingsDbPath = path.join(pluginPath, 'settings.db')
    } else {
      settingsDbPath = path.join(parent.parent.datapath, 'meshcentral-databasesync-settings.db')
    }
  } else if (parent && parent.datapath) {
    var pluginPath = path.join(parent.datapath, 'plugins', 'remorahqdatabasesync')
    if (fs.existsSync(pluginPath)) {
      settingsDbPath = path.join(pluginPath, 'settings.db')
    } else {
      settingsDbPath = path.join(parent.datapath, 'meshcentral-databasesync-settings.db')
    }
  } else {
    var possiblePaths = [
      path.join(process.cwd(), 'meshcentral-data', 'plugins', 'remorahqdatabasesync'),
      path.join(__dirname, '..', '..', 'meshcentral-data', 'plugins', 'remorahqdatabasesync'),
      path.join(__dirname, '..', 'meshcentral-data', 'plugins', 'remorahqdatabasesync')
    ]
    for (var i = 0; i < possiblePaths.length; i++) {
      if (fs.existsSync(possiblePaths[i])) {
        settingsDbPath = path.join(possiblePaths[i], 'settings.db')
        break
      }
    }
    if (!settingsDbPath) {
      var datapath = path.join(process.cwd(), 'meshcentral-data')
      settingsDbPath = path.join(datapath, 'meshcentral-databasesync-settings.db')
    }
  }

  function initSettingsDb() {
    if (!Database) {
      console.log('[RemoraHQ-DatabaseSync] better-sqlite3 not installed. Run: npm install better-sqlite3')
      return false
    }
    try {
      settingsDb = new Database(settingsDbPath)
      settingsDb.exec(`
        CREATE TABLE IF NOT EXISTS databases (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          connectionString TEXT NOT NULL,
          dbName TEXT,
          status TEXT,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          dbId TEXT,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_dbId ON events(dbId);
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      `)
      
      var cleanupInterval = setInterval(function () {
        if (settingsDb) {
          try {
            var oneDayAgo = Date.now() - (24 * 60 * 60 * 1000)
            var deleted = settingsDb.prepare('DELETE FROM events WHERE timestamp < ?').run(oneDayAgo)
            if (deleted.changes > 0) {
              console.log('[RemoraHQ-DatabaseSync] Cleaned up ' + deleted.changes + ' old events')
            }
          } catch (e) {
            console.log('[RemoraHQ-DatabaseSync] Error cleaning up events:', e.message)
          }
        }
      }, 60 * 60 * 1000)
      return true
    } catch (e) {
      console.log('[RemoraHQ-DatabaseSync] Error initializing settings.db:', e.message)
      return false
    }
  }

  function logEvent(dbId, type, message) {
    if (!settingsDb) return
    try {
      settingsDb.prepare('INSERT INTO events (dbId, type, message, timestamp) VALUES (?, ?, ?, ?)').run(
        dbId || null, type, message, Date.now()
      )
    } catch (e) {
      console.log('[RemoraHQ-DatabaseSync] Error logging event:', e.message)
    }
  }

  function getDatabases() {
    if (!settingsDb) return []
    try {
      var rows = settingsDb.prepare('SELECT * FROM databases ORDER BY createdAt DESC').all()
      return rows.map(function (row) {
        var db = JSON.parse(JSON.stringify(row))
        try {
          if (db.connectionString) {
            db.connectionString = Buffer.from(db.connectionString, 'base64').toString('utf8')
          }
        } catch (e) { }
        return db
      })
    } catch (e) {
      console.log('[RemoraHQ-DatabaseSync] Error getting databases:', e.message)
      return []
    }
  }

  function addDatabase(dbData) {
    if (!settingsDb) return false
    try {
      var encrypted = Buffer.from(dbData.connectionString).toString('base64')
      settingsDb.prepare(`
        INSERT INTO databases (id, label, connectionString, dbName, status, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        dbData.id, dbData.label, encrypted, dbData.dbName || '', dbData.status || 'online',
        Date.now(), Date.now()
      )
      logEvent(dbData.id, 'CONN', 'Database connected: ' + dbData.label)
      return true
    } catch (e) {
      console.log('[RemoraHQ-DatabaseSync] Error adding database:', e.message)
      return false
    }
  }

  function updateDatabase(dbId, dbData) {
    if (!settingsDb) return false
    try {
      var encrypted = Buffer.from(dbData.connectionString).toString('base64')
      settingsDb.prepare(`
        UPDATE databases SET label = ?, connectionString = ?, dbName = ?, status = ?, updatedAt = ?
        WHERE id = ?
      `).run(
        dbData.label, encrypted, dbData.dbName || '', dbData.status || 'online', Date.now(), dbId
      )
      return true
    } catch (e) {
      console.log('[RemoraHQ-DatabaseSync] Error updating database:', e.message)
      return false
    }
  }

  function removeDatabase(dbId) {
    if (!settingsDb) return false
    try {
      settingsDb.prepare('DELETE FROM databases WHERE id = ?').run(dbId)
      logEvent(dbId, 'DISCONN', 'Database disconnected')
      return true
    } catch (e) {
      console.log('[RemoraHQ-DatabaseSync] Error removing database:', e.message)
      return false
    }
  }

  function getEvents(dbId, limit) {
    if (!settingsDb) return []
    try {
      var query = dbId
        ? 'SELECT * FROM events WHERE dbId = ? ORDER BY timestamp DESC LIMIT ?'
        : 'SELECT * FROM events ORDER BY timestamp DESC LIMIT ?'
      var rows = dbId
        ? settingsDb.prepare(query).all(dbId, limit || 100)
        : settingsDb.prepare(query).all(limit || 100)
      return rows
    } catch (e) {
      console.log('[RemoraHQ-DatabaseSync] Error getting events:', e.message)
      return []
    }
  }

  function getSystemMetrics() {
    var totalMem = os.totalmem()
    var freeMem = os.freemem()
    var usedMem = totalMem - freeMem
    var memPercent = Math.round((usedMem / totalMem) * 100)
    
    var cpuPercent = 0
    try {
      if (process.platform === 'win32') {
        var execSync = require('child_process').execSync
        try {
          var result = execSync('wmic cpu get loadpercentage /format:value', { encoding: 'utf8', timeout: 5000 })
          var lines = result.split('\n')
          for (var i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('LoadPercentage=') === 0) {
              cpuPercent = parseInt(lines[i].split('=')[1].trim()) || 0
              console.log('[RemoraHQ-DatabaseSync] CPU Load from wmic:', cpuPercent + '%')
              break
            }
          }
          if (cpuPercent === 0) {
            console.log('[RemoraHQ-DatabaseSync] wmic result:', result)
          }
        } catch (e) {
          console.log('[RemoraHQ-DatabaseSync] Error getting CPU load from wmic:', e.message)
          cpuPercent = 0
        }
      } else {
        var cpus = os.cpus()
        var loadAvg = os.loadavg()
        if (loadAvg && loadAvg.length > 0 && cpus.length > 0) {
          cpuPercent = Math.min(100, Math.round((loadAvg[0] / cpus.length) * 100))
          console.log('[RemoraHQ-DatabaseSync] CPU Load from loadavg:', cpuPercent + '%')
        }
      }
    } catch (e) {
      console.log('[RemoraHQ-DatabaseSync] Error getting CPU load:', e.message)
      cpuPercent = 0
    }
    
    return {
      memoryUsed: usedMem,
      memoryTotal: totalMem,
      memoryPercent: memPercent,
      cpuPercent: cpuPercent
    }
  }

  function getDiskSpace() {
    try {
      if (process.platform === 'win32') {
        var execSync = require('child_process').execSync
        try {
          var drive = process.cwd().substring(0, 2)
          var result = execSync('wmic logicaldisk where "DeviceID=\'' + drive + '\'" get Size,FreeSpace /format:value', { encoding: 'utf8' })
          var lines = result.split('\n')
          var freeSpace = 0
          var totalSize = 0
          for (var i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('FreeSpace=') === 0) {
              freeSpace = parseInt(lines[i].split('=')[1]) || 0
            }
            if (lines[i].indexOf('Size=') === 0) {
              totalSize = parseInt(lines[i].split('=')[1]) || 0
            }
          }
          return {
            size: 0,
            available: freeSpace,
            total: totalSize,
            used: totalSize - freeSpace
          }
        } catch (e) {
          return { size: 0, available: 0, total: 0, used: 0 }
        }
      } else {
        var stats = require('fs').statfsSync ? require('fs').statfsSync('/') : null
        if (stats) {
          var total = stats.blocks * stats.bsize
          var free = stats.bavail * stats.bsize
          return {
            size: 0,
            available: free,
            total: total,
            used: total - free
          }
        }
        return { size: 0, available: 0, total: 0, used: 0 }
      }
    } catch (e) {
      return { size: 0, available: 0, total: 0, used: 0 }
    }
  }

  function probeMongoDb(connectionString, dbId) {
    return new Promise(function (resolve) {
      if (!MongoClient) {
        return resolve({ ok: false, error: 'MongoDB driver not installed. Run: npm install mongodb' })
      }
      if (!connectionString) {
        return resolve({ ok: false, error: 'No connectionString provided' })
      }
      
      var connectStartTime = Date.now()
      var client = null
      
      MongoClient.connect(connectionString, {
        maxPoolSize: 2,
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000
      }).then(function (c) {
        var connectLatency = Date.now() - connectStartTime
        client = c
        var db = client.db()
        var dbName = db.databaseName
        
        var probeStartTime = Date.now()
        return Promise.all([
          db.admin().serverStatus().catch(function (err) { 
            console.log('[RemoraHQ-DatabaseSync] Error getting serverStatus:', err.message)
            return null 
          }),
          db.listCollections().toArray().catch(function () { return [] }),
          db.stats().catch(function () { return null }),
          Promise.resolve(dbName),
          Promise.resolve(connectLatency),
          Promise.resolve(probeStartTime)
        ])
      }).then(function (results) {
        var connectLatency = results[4]
        var probeLatency = Date.now() - results[5]
        var finalLatency = connectLatency
        
        var serverStatus = results[0]
        var collections = results[1]
        var dbStats = results[2]
        var dbName = results[3]
        var systemMetrics = getSystemMetrics()
        var diskSpace = getDiskSpace()
        
        logEvent(dbId, 'PROBE', 'Probing database: ' + dbName + ' (latency: ' + finalLatency + 'ms)')
        
        var networkIO = { in: 0, out: 0, total: 0 }
        try {
          if (process.platform === 'win32') {
            var execSync = require('child_process').execSync
            try {
              var netResult = execSync('chcp 65001 >nul && netstat -e', { encoding: 'utf8', timeout: 5000, shell: true })
              var netLines = netResult.split('\n')
              for (var i = 0; i < netLines.length; i++) {
                var line = netLines[i]
                if (line.indexOf('Bytes') >= 0 || line.indexOf('байт') >= 0 || /^\s*\d+/.test(line)) {
                  var parts = line.trim().split(/\s+/)
                  if (parts.length >= 3) {
                    var bytesIn = parseFloat(parts[parts.length - 2].replace(/,/g, '').replace(/\s/g, '')) || 0
                    var bytesOut = parseFloat(parts[parts.length - 1].replace(/,/g, '').replace(/\s/g, '')) || 0
                    if (bytesIn > 0 || bytesOut > 0) {
                      networkIO.in = bytesIn / (1024 * 1024)
                      networkIO.out = bytesOut / (1024 * 1024)
                      networkIO.total = networkIO.in + networkIO.out
                      console.log('[RemoraHQ-DatabaseSync] Network I/O from netstat - IN:', networkIO.in.toFixed(2), 'MB, OUT:', networkIO.out.toFixed(2), 'MB')
                      break
                    }
                  }
                }
              }
              if (networkIO.total === 0) {
                console.log('[RemoraHQ-DatabaseSync] netstat parsing failed, trying MongoDB network stats')
                if (serverStatus && serverStatus.network) {
                  networkIO.in = (serverStatus.network.bytesIn || 0) / (1024 * 1024)
                  networkIO.out = (serverStatus.network.bytesOut || 0) / (1024 * 1024)
                  networkIO.total = networkIO.in + networkIO.out
                  console.log('[RemoraHQ-DatabaseSync] Using MongoDB network stats - IN:', networkIO.in.toFixed(2), 'MB, OUT:', networkIO.out.toFixed(2), 'MB')
                }
              }
            } catch (e) {
              console.log('[RemoraHQ-DatabaseSync] Error getting network stats from netstat:', e.message)
              if (serverStatus && serverStatus.network) {
                networkIO.in = (serverStatus.network.bytesIn || 0) / (1024 * 1024)
                networkIO.out = (serverStatus.network.bytesOut || 0) / (1024 * 1024)
                networkIO.total = networkIO.in + networkIO.out
                console.log('[RemoraHQ-DatabaseSync] Using MongoDB network stats - IN:', networkIO.in.toFixed(2), 'MB, OUT:', networkIO.out.toFixed(2), 'MB')
              }
            }
          } else {
            if (serverStatus && serverStatus.network) {
              networkIO.in = (serverStatus.network.bytesIn || 0) / (1024 * 1024)
              networkIO.out = (serverStatus.network.bytesOut || 0) / (1024 * 1024)
              networkIO.total = networkIO.in + networkIO.out
              console.log('[RemoraHQ-DatabaseSync] Using MongoDB network stats - IN:', networkIO.in.toFixed(2), 'MB, OUT:', networkIO.out.toFixed(2), 'MB')
            }
          }
        } catch (e) {
          console.log('[RemoraHQ-DatabaseSync] Error getting network I/O:', e.message)
          networkIO = { in: 0, out: 0, total: 0 }
        }
        
        var metrics = {
          connections: 0, availableConnections: 0, opcounters: null,
          uptime: 0, version: 'unknown', storageSize: 0, dataSize: 0,
          objects: 0, replicaSet: null, latency: finalLatency,
          memoryUsed: systemMetrics.memoryUsed,
          memoryTotal: systemMetrics.memoryTotal,
          memoryPercent: systemMetrics.memoryPercent,
          cpuPercent: systemMetrics.cpuPercent,
          networkIO: networkIO,
          diskSpace: diskSpace
        }
        
        if (serverStatus) {
          console.log('[RemoraHQ-DatabaseSync] ServerStatus object keys:', Object.keys(serverStatus))
          console.log('[RemoraHQ-DatabaseSync] ServerStatus.uptime raw:', serverStatus.uptime, 'type:', typeof serverStatus.uptime)
          
          metrics.connections = (serverStatus.connections && serverStatus.connections.current) || 0
          metrics.availableConnections = (serverStatus.connections && serverStatus.connections.available) || 0
          metrics.opcounters = serverStatus.opcounters || null
          metrics.uptime = serverStatus.uptime || 0
          metrics.version = serverStatus.version || 'unknown'
          
          console.log('[RemoraHQ-DatabaseSync] ServerStatus uptime:', serverStatus.uptime, 'seconds')
          console.log('[RemoraHQ-DatabaseSync] Metrics uptime:', metrics.uptime)
          
          if (!serverStatus.uptime || serverStatus.uptime === 0) {
            console.log('[RemoraHQ-DatabaseSync] WARNING: uptime is 0 or missing! Full serverStatus:', JSON.stringify(serverStatus).substring(0, 500))
          }
          if (serverStatus.repl) {
            metrics.replicaSet = {
              setName: serverStatus.repl.setName || null,
              ismaster: serverStatus.repl.ismaster || false,
              primary: serverStatus.repl.primary || null,
              hosts: serverStatus.repl.hosts || []
            }
          }
        }
        if (dbStats) {
          metrics.storageSize = Math.round((dbStats.storageSize || 0) * 100) / 100
          metrics.dataSize = Math.round((dbStats.dataSize || 0) * 100) / 100
          metrics.objects = dbStats.objects || 0
        }
        
        var collectionNames = collections.map(function (c) { return c.name })
        if (client) { client.close().catch(function () { }) }
        resolve({ ok: true, dbName: dbName, metrics: metrics, collections: collectionNames })
      }).catch(function (err) {
        if (client) { try { client.close() } catch (e) { } }
        logEvent(dbId, 'ERROR', 'Probe error: ' + err.message)
        resolve({ ok: false, error: err.message })
      })
    })
  }

  obj.handleAdminReq = function (req, res, user) {
    var parsedUrl = require('url').parse(req.url, true)
    var action = parsedUrl.query.action || ''
    res.setHeader('Content-Type', 'application/json')

    if (action === 'ping') {
      res.end(JSON.stringify({ result: 'ok', version: obj.version, mongo: !!MongoClient }))
      return
    }

    if (action === 'probe') {
      var body = ''
      req.on('data', function (chunk) { body += chunk.toString() })
      req.on('end', function () {
        var data = {}
        try { data = JSON.parse(body) } catch (e) { }
        var cs = data.connectionString || parsedUrl.query.cs || ''
        probeMongoDb(cs).then(function (result) {
          res.end(JSON.stringify(result))
        }).catch(function (err) {
          res.end(JSON.stringify({ ok: false, error: err.message }))
        })
      })
      return
    }

    res.end(JSON.stringify({ result: 'error', error: 'Unknown action: ' + action }))
  }

  obj.serveraction = function (command, myobj, parent) {
    var sub = command.pluginaction || command.sub || ''
    var response = {
      action: 'plugin', plugin: obj.pluginid, pluginaction: sub,
      responseid: command.responseid
    }
    var sendFn = function (data) {
      try {
        if (typeof myobj.send === 'function') { myobj.send(data); return }
        if (myobj.ws && typeof myobj.ws.send === 'function') { myobj.ws.send(JSON.stringify(data)); return }
      } catch (e) { }
    }

    if (sub === 'ping') {
      response.result = 'ok'
      response.version = obj.version
      response.mongo = !!MongoClient
      sendFn(response)
      return
    }

    if (sub === 'probe') {
      var cs = command.connectionString || ''
      var dbId = command.dbId || null
      probeMongoDb(cs, dbId).then(function (res) {
        response.result = res.ok ? 'ok' : 'error'
        response.error = res.error || null
        response.metrics = res.metrics || null
        response.dbName = res.dbName || null
        response.collections = res.collections || null
        sendFn(response)
      }).catch(function (err) {
        response.result = 'error'
        response.error = err.message
        sendFn(response)
      })
      return
    }

    if (sub === 'getdatabases') {
      response.result = 'ok'
      response.databases = getDatabases()
      sendFn(response)
      return
    }

    if (sub === 'adddatabase') {
      if (command.dbData) {
        var success = addDatabase(command.dbData)
        response.result = success ? 'ok' : 'error'
        response.error = success ? null : 'Failed to add database to settings.db'
      } else {
        response.result = 'error'
        response.error = 'dbData not provided'
      }
      sendFn(response)
      return
    }

    if (sub === 'updatedatabase') {
      if (command.dbId && command.dbData) {
        var success = updateDatabase(command.dbId, command.dbData)
        response.result = success ? 'ok' : 'error'
        response.error = success ? null : 'Failed to update database in settings.db'
      } else {
        response.result = 'error'
        response.error = 'dbId or dbData not provided'
      }
      sendFn(response)
      return
    }

    if (sub === 'removedatabase') {
      if (command.dbId) {
        var success = removeDatabase(command.dbId)
        response.result = success ? 'ok' : 'error'
        response.error = success ? null : 'Failed to remove database from settings.db'
      } else {
        response.result = 'error'
        response.error = 'dbId not provided'
      }
      sendFn(response)
      return
    }

    if (sub === 'getevents') {
      response.result = 'ok'
      response.events = getEvents(command.dbId, command.limit || 100)
      sendFn(response)
      return
    }

    response.result = 'error'
    response.error = 'Unknown pluginaction: ' + sub
    sendFn(response)
  }

  obj.server_startup = function () {
    var dbInit = initSettingsDb()
    var mongoStatus = MongoClient ? 'available' : 'NOT installed'
    var dbStatus = dbInit ? 'initialized' : 'NOT initialized'
    console.log('[RemoraHQ-DatabaseSync] Plugin loaded v' + obj.version)
    console.log('[RemoraHQ-DatabaseSync] MongoDB driver: ' + mongoStatus)
    console.log('[RemoraHQ-DatabaseSync] Settings DB: ' + dbStatus)
    if (dbInit) {
      logEvent(null, 'SYSTEM', 'Plugin started v' + obj.version)
    }
  }

  obj.server_shutdown = function () {
    if (settingsDb) {
      logEvent(null, 'SYSTEM', 'Plugin stopped')
      try {
        settingsDb.close()
      } catch (e) { }
    }
    console.log('[RemoraHQ-DatabaseSync] Plugin stopped')
  }

  return obj
}
