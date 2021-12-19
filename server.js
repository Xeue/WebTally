#!/usr/bin/env node
/*jshint esversion: 6 */
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';
import { createServer } from 'https';
import { createRequire } from "module";
import * as fs from 'fs';
import * as readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const reader = require("readline-sync");

const args = process.argv.slice(2);
const version = "4.1";
const type = "Server";
const loadTime = new Date().getTime();
const myID = `S_${loadTime}_${version}`;

let configLocation = __dirname;
let port = 443;
let host;
let loggingLevel = "W";
let debugLineNum = false;
let createLogFile = true;
let argLoggingLevel;
let ownHTTPserver = false;
let dataBase;
let certPath;
let keyPath;
let serverName = "WebTally Server v4";

let config;
let state = {};

var coreServer;
var serverHTTPS;

printHeader();

loadArgs();

state = setUpStates(state);

loadConfig();

startServer();

startLoops();

function startServer() {
  if (ownHTTPserver) {
    serverHTTPS = startHTTPS();
    log("Running as own HTTPS server and hosting UI internally");
    coreServer = new WebSocketServer({ server: serverHTTPS });
  } else {
    log("Running as \x1b[33mstandalone\x1b[37m websocket server");
    coreServer = new WebSocketServer({ port: port });
  }

  // Main websocket server functionality
  coreServer.on('connection', function connection(socket) {
    log("New connection established, sending it other severs list", "D");

    // Sending server list
    let payload = {};
    payload.command = "server";
    payload.servers = state.servers.getStatus();
    sendData(socket, payload);

    socket.pingStatus = "alive";

    socket.on('message', function message(msgJSON) {
      log('Received: '+msgJSON, "A");
      let msgObj = {};
      let pObj;
      let hObj;
      try {
        msgObj = JSON.parse(msgJSON);
        pObj = msgObj.payload;
        hObj = msgObj.header;
        if (typeof pObj.source == "undefined") {
          pObj.source = "default";
        }
        switch (pObj.command) {
          case "meta":
            log('Received: '+msgJSON, "D");
            socket.send("Received meta");
            break;
          case "register":
            if (typeof socket.type == "undefined") {
              socket.type = hObj.type;
            }
            if (typeof socket.ID == "undefined") {
              socket.ID = hObj.fromID;
            }
            switch (hObj.type) {
              case "Config":
                log('\x1b[32m'+hObj.fromID+'\x1b[0m Registered as new config controller', "D");
                break;
              case "Server":
                let address = pObj.address;
                let name = pObj.name;
                socket.address = address;
                socket.name = name;
                log("\x1b[32m"+hObj.fromID+'\x1b[0m Registered as new server', "D");
                log("\x1b[32m"+address+"\x1b[0m Registered as new inbound server connection", "S");
                state.servers.add(address);
                state.servers.update(address, hObj, name);
                break;
              case "Admin":
                log('\x1b[32m'+hObj.fromID+'\x1b[0m Registered as new admin controller', "D");
                let payload = {};
                payload.command = "server";
                payload.servers = state.servers.getDetails("ALL");
                payload.servers[host] = state.servers.getThisServer();
                sendAdmins(makePacket(payload));
                break;
              default:
                log("\x1b[32m"+hObj.fromID+"\x1b[0m Registered as new client", "D");
                if (typeof pObj.data.camera !== "undefined") {
                  socket.camera = pObj.data.camera;
                }
                sendConfigs(msgObj, socket);
                sendServers(msgObj);
                state.tally.updateClients();
            }
            break;
          case "disconnect":
            log("\x1b[31m"+pObj.data.ID+"\x1b[0m Connection closed", "D");
            sendConfigs(msgObj, socket);
            sendServers(msgObj);
            break;
          case "tally":
            sendServers(msgObj);
            sendClients(msgObj, socket);
            state.tally.update(pObj.busses, pObj.source);
            break;
          case "config":
            log("Config data is being sent to clients", "D");
            if (socket.ID == hObj.fromID) {
              sendSelf(msgObj, socket);
            }
            sendAll(msgObj, socket);
            state.tally.updateClients();
            break;
          case "command":
            log("A command is being sent to clients", "D");
            sendAll(msgObj, socket);
            break;
          case "pong":
            socket.pingStatus = "alive";
            break;
          case "ping":
            socket.pingStatus = "alive";
            let payload = {};
            payload.command = "pong";
            sendData(socket, payload);
            break;
          case "server":
            log("Received new servers list from other server", "D");
            let servers = pObj.servers;
            for (let server in servers) {
              state.servers.add(server);
            }
            break;
          case "error":
            break;
          default:
            log("Unknown message: "+msgJSON, "W");
            sendAll(msgObj);
        }
      } catch (e) {
        try {
          msgObj = JSON.parse(msgJSON);
          if (typeof msgObj.type == "undefined") {
            let stack = e.stack.toString().split(/\r\n|\n/);
            stack = JSON.stringify(stack, null, 4);
            log(`Server error, stack trace: ${stack}`, "E");
          } else {
            log("A device is using old tally format, upgrade it to v4.0 or above", "E");
          }
        } catch (e2) {
          log("Invalid JSON - "+e, "E");
        }
      }
    });

    socket.on('close', function() {
      try {
        let oldId = JSON.parse(JSON.stringify(socket.ID));
        log("\x1b[31m"+oldId+"\x1b[0m Connection closed", "D");
        if (socket.type == "Server") {
          log("\x1b[31m"+socket.address+"\x1b[0m Inbound connection closed", "W");
        }
        let packet = makePacket({"command":"disconnect","data":{"ID":oldId}});
        sendServers(packet);
        sendConfigs(packet, socket);
      } catch (e) {
        log("Could not end connection cleanly","E");
      }
    });
  });

  coreServer.on('error', function() {
    log("Server failed to start or crashed, please check the port is not in use", "E");
    process.exit(1);
  });

  if (ownHTTPserver) {
    serverHTTPS.listen(port)
  }
}

function startLoops() {

  // 5 Second ping loop
  setInterval(() => {
    doPing();
    connectToOtherServers();
  }, 5000);

  // 1 Minute ping loop
  setInterval(() => {
    connectToOtherServers(true);
  }, 60000);

}

function setUpStates(state) {
  let dir = `${configLocation}/states`;
  let fileNameTally = dir+"/tallyState.json";
  let fileNameServers = dir+"/serversState.json";

  if (!fs.existsSync(dir)){
    fs.mkdirSync(dir, { recursive: true });
  }

  // Tally

  state.tally = {};
  fs.readFile(fileNameTally, function(err, data) {
    if (typeof data !== "undefined") {
      try {
        state.tally.data = JSON.parse(data);
      } catch (e) {
        log("Could not parse tally state data", "W");
      }
    } else {
      state.tally.data = {"default":{"main":{}}};
    }
    if (err) {
      log("Could not read tally state from file, either invalid permissions or it doesn't exist yet", "W");
    }
  });

  state.tally.update = function(busses, source = "default") {
    let savedBusses = state.tally.data[source];

    for (let busName in busses) {
      if (busses.hasOwnProperty(busName)) {
        let bus = busses[busName];
        for (var camNum in bus) {
          if (bus.hasOwnProperty(camNum)) {
            let cam = bus[camNum];

            if (typeof savedBusses[busName] == "undefined") {
              state.tally.newBus(busName, source);
            }

            let savedBus = savedBusses[busName];

            if (typeof savedBus[camNum] == "undefined") {
              savedBus[camNum] = {"prog":false,"prev":false};
            }

            if (typeof cam.prev != "undefined") {
              savedBus[camNum].prev = cam.prev;
            }
            if (typeof cam.prog != "undefined") {
              savedBus[camNum].prog = cam.prog;
            }

          }
        }
      }
    }

    if (dataBase === false) {
      let data = JSON.stringify(state.tally.data);
      fs.writeFile(fileNameTally, data, err => {
        if (err) {
          log("Could not save tally state to file, permissions?", "W");
        }
      });
    } else {
      log("Not implemented yet - database connection", "W");
    }

  };

  state.tally.newSoruce = function(source) {
    state.tally.data[source] = {
      "busses":{
        "main":{}
      }
    };
  };

  state.tally.newBus = function(busName, source = "default") {
    if (typeof state.tally.data[source] == "undefined") {
      state.tally.newSoruce(source);
    }
    state.tally.data[source][busName] = {};
  };

  state.tally.updateClients = function() {
    setTimeout(function() {
      for (var source in state.tally.data) {
        if (state.tally.data.hasOwnProperty(source)) {
          let payload = {};
          payload.busses = {};
          payload.busses = state.tally.data[source];
          payload.command = "tally";
          payload.source = source;
          let packet = makePacket(payload);
          sendClients(packet);
        }
      }
    },100);
  };

  // Servers

  state.servers = {};
  state.servers.data = {};
  fs.readFile(fileNameServers, function(err, data) {
    if (typeof data !== "undefined") {
      let serverData = state.servers.data;
      try {
        serverData = JSON.parse(data);
        for (var server in serverData) {
          if (serverData.hasOwnProperty(server)) {
            serverData[server].socket = null;
            serverData[server].connected = false;
          }
        }
      } catch (e) {
        log("Could not parse server state data", "W");
      }
    }
    if (err) {
      log("Could not read servers state from file, either invalid permissions or it doesn't exist yet", "W");
    }
  });

  state.servers.add = function(url, header, name) {
    if (!state.servers.data.hasOwnProperty(url) && url !== host) {
      log("Adding new address: "+url, "D");
      state.servers.data[url] = {
        "socket":null,
        "active":true,
        "connected":false,
        "attempts":0,
        "version":null,
        "ID":null,
        "Name":`Webtally v4 server`
      };
      if (typeof header !== "undefined") {
        state.servers.data[url].version = header.version;
        state.servers.data[url].ID = header.fromID;
        if (typeof name !== "undefined") {
          state.servers.data[address].Name = name;
        } else {
          state.servers.data[address].Name = `Webtally v${header.version} server`;
        }
      }
      connectToOtherServers();
      if (coreServer) {
        sendServerListToClients();
      }
    } else if (url !== host) {
      log("Address already registered", "D");
      if (typeof state.servers.data[url].active === false) {
        state.servers.data[url].active = true;
        connectToOtherServers();
      }
    }

    state.servers.save();
  };

  state.servers.update = function(address, header, name) {
    if (state.servers.data.hasOwnProperty(address) && address !== host) {
      log("Updating server details for: "+address, "D");
      state.servers.data[address].version = header.version;
      state.servers.data[address].ID = header.fromID;
      if (typeof name !== "undefined") {
        state.servers.data[address].Name = name;
      } else {
        state.servers.data[address].Name = `Webtally v${header.version} server`;
      }
      let payload = {};
      payload.command = "server";
      payload.servers = state.servers.getDetails(address);
      sendAdmins(makePacket(payload));
      sendServerListToClients();
    } else {
      log("Address not registered, adding: "+address, "D");
      state.servers.add(address, header, name);
    }

    state.servers.save();
  }

  state.servers.remove = function(url) {
    if (!state.servers.data.hasOwnProperty(url)) {
      log("Removing address and closing connection to: "+url, "D");
      try {
        state.servers.data[url].socket.close();
      } catch (e) {
        log("Server connection already closed","W");
      }
      delete state.servers.data[url];
    }

    let payload = {};
    payload.command = "server";
    payload.servers = state.servers.getDetails(address);
    sendAdmins(makePacket(payload));
    state.servers.save();
  }

  state.servers.getURLs = function(print = false) {
    let serverDataList = [];
    let serverData = state.servers.data;
    for (var server in serverData) {
      if (serverData.hasOwnProperty(server) && typeof serverData[server] !== 'function' && serverData[server].connected == true) {
        serverDataList.push(server);
      }
      if (print) {
        log(`${server} - Connected: ${serverData[server].connected} Active: ${serverData[server].active}`,"S");
      }
    }
    return serverDataList;
  }

  state.servers.getStatus = function(print = false) {
    let serverDataTrimmed = {};
    let serverData = state.servers.data;
    for (var server in serverData) {
      if (serverData.hasOwnProperty(server) && typeof serverData[server] !== 'function') {
        serverDataTrimmed[server] = {};
        serverDataTrimmed[server].active = serverData[server].active;
        serverDataTrimmed[server].connected = serverData[server].connected;
        if (print) {
          log(`${server} - Connected: ${serverData[server].connected} Active: ${serverData[server].active}`,"S");
        }
      }
    }
    return serverDataTrimmed;
  }

  state.servers.getDetails = function(server = "ALL", print = false) {
    let details = {};
    if (server == "ALL") {
      for (var data in state.servers.data) {
        if (state.servers.data.hasOwnProperty(data)) {
          details[data] = {};
          details[data].socket = "SOCKET OBJECT";
          details[data].active = state.servers.data[data].active;
          details[data].connected = state.servers.data[data].connected;
          details[data].attempts = state.servers.data[data].attempts;
          details[data].version = state.servers.data[data].version;
          details[data].ID = state.servers.data[data].ID;
          details[data].Name = state.servers.data[data].Name;
        }
      }

      for (var detail in details) {
        if (details.hasOwnProperty(detail)) {
          if (details[detail].connected) {
            details[detail].socket = "SOCKET OBJECT";
          } else {
            details[detail].socket = null;
          }
        }
      }
    } else {
      if (typeof state.servers.data[server] !== "undefined") {
        details[server] = {};
        details[server].socket = "SOCKET OBJECT";
        details[server].active = state.servers.data[server].active;
        details[server].connected = state.servers.data[server].connected;
        details[server].attempts = state.servers.data[server].attempts;
        details[server].version = state.servers.data[server].version;
        details[server].ID = state.servers.data[server].ID;
        details[server].Name = state.servers.data[server].Name;
      }
    }
    if (print) {
      log("Server details: "+JSON.stringify(details, null, 4), "A");
    }
    return details;
  }

  state.servers.getThisServer = function() {
    let thisServer = {
      "socket": "SOCKET OBJECT",
      "active":true,
      "connected":true,
      "attempts":0,
      "version":version,
      "ID":myID,
      "Name":serverName
    }
    return thisServer;
  };

  state.servers.save = function() {
    if (dataBase === false) {
      let data = JSON.stringify(state.servers.getDetails("ALL"));
      fs.writeFile(fileNameServers, data, err => {
        if (err) {
          log("Could not save servers state to file, permissions?", "W");
        }
      });
    } else {
      log("Not implemented yet - database connection", "W");
    }
  }

  return state;
}

function doPing() {
  log("Doing ping", "A");
  let counts = {};
  counts.alive = 0;
  counts.dead = 0;
  coreServer.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      if (client.pingStatus == "alive") {
        counts.alive++;
        let payload = {};
        payload.command = "ping";
        sendData(client, payload);
        client.pingStatus = "pending";
      } else if (client.pingStatus == "pending") {
        client.pingStatus = "dead";
      } else {
        counts.dead++;
      }
    }
  });
  log("Clients alive: "+counts.alive, "A");
  log("Clients dead: "+counts.dead, "A");
}

function connectToOtherServers(retry = false) {
  let serverData = state.servers.data;
  for (let server in serverData) {
    if (serverData.hasOwnProperty(server) && typeof serverData[server] !== 'function') {
      let thisServer = serverData[server];
      if ((!thisServer.connected && thisServer.active && thisServer.attempts < 3) || (retry && !thisServer.connected)) {
        let outbound;
        let inError = false;
        if (retry) {
          log("Retrying connection to dead server: \x1b[31m"+server+"\x1b[0m", "W");
        }
        outbound = new WebSocket("wss://"+server);

        thisServer.socket = outbound;

        outbound.on('open', function open() {
          let payload = {};
          payload.command = "register";
          payload.address = host;
          payload.name = serverName;
          sendData(outbound, payload);
          log("\x1b[32m"+server+"\x1b[0m Established as new outbound server connection", "S");
          thisServer.connected = true;
          thisServer.attempts = 0;
          payload = {};
          payload.command = "server";
          payload.servers = state.servers.getDetails(server);
          sendAdmins(makePacket(payload));
        });

        outbound.on('message', function message(msgJSON) {
          log('Received from other server: '+msgJSON, "A");
          let msgObj = {};
          let pObj;
          let hObj;
          try {
            msgObj = JSON.parse(msgJSON);
            pObj = msgObj.payload;
            hObj = msgObj.header;
            switch (pObj.command) {
              case "ping":
                let payload = {};
                payload.command = "pong";
                sendData(outbound, payload);
                break;
              case "server":
                log("Received new servers list from other server", "D");
                let servers = pObj.servers;
                for (let server in servers) {
                  state.servers.add(server);
                }
                break;
              case "tally":
                let returnObj = updateHeader(msgObj);
                let recipients = msgObj.header.recipients;
                coreServer.clients.forEach(function each(client) {
                  if (client !== outbound && client.readyState === WebSocket.OPEN) {
                    if (!recipients.includes(client.address)) {
                      client.send(JSON.stringify(returnObj));
                    }
                  }
                });
                break;
              default:
                log("Received unknown from other server: \x1b[2m"+msgJSON+"\x1b[0m", "W");
            }
          } catch (e) {
            try {
              msgObj = JSON.parse(msgJSON);
              if (typeof msgObj.type == "undefined") {
                let stack = e.stack.toString().split(/\r\n|\n/);
                stack = JSON.stringify(stack, null, 4);
                log(`Server error, stack trace: ${stack}`, "E");
              } else {
                log("A device is using old tally format, upgrade it to v4.0 or above", "E");
              }
            } catch (e2) {
              log("Invalid JSON from other server- "+e, "E");
            }
          }
        });

        outbound.on('close', function close() {
          thisServer.connected = false;
          thisServer.socket = null;
          thisServer.attempts++;
          if (!inError) {
            log("\x1b[31m"+server+"\x1b[0m Outbound connection closed", "W");
            sendServerListToClients();
            let payload = {};
            payload.command = "server";
            payload.servers = state.servers.getDetails(server);
            sendAdmins(makePacket(payload));
          }
        });

        outbound.on('error', function error() {
          inError = true;
          log("Could not connect to server: \x1b[31m"+server+"\x1b[0m", "E");
        });
      } else if (!thisServer.connected && thisServer.active) {
        thisServer.active = false;
      }
    }
  }
}

function sendServerListToClients() {
  log("Sending updated server list to clients", "D");
  let payload = {};
  payload.command = "server";
  payload.servers = state.servers.getDetails("ALL", true);

  coreServer.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN && client.type !== "Admin") {
      sendData(client, payload);
    }
  });
}

function sendServers(json) { //Only servers
  let obj = {};
  if (typeof json == "object") {
    obj = json;
  } else {
    obj = JSON.parse(json);
  }

  let recipients = obj.header.recipients;
  let returnObj = updateHeader(obj);
  let serverData = state.servers.data;
  state.servers.getDetails("ALL",true)
  for (var server in serverData) {
    if (serverData.hasOwnProperty(server) && serverData[server].connected == true && serverData[server].socket !== null) {
      if (!recipients.includes(server)) {
        serverData[server].socket.send(JSON.stringify(returnObj));
      }
    }
  }
}

function sendClients(json, socket = null) { //All but servers
  let obj = {};
  if (typeof json == "object") {
    obj = json;
  } else {
    obj = JSON.parse(json);
  }

  let recipients = obj.header.recipients;
  let returnObj = updateHeader(obj);
  coreServer.clients.forEach(function each(client) {
    if (client !== socket && client.readyState === WebSocket.OPEN) {
      if (!recipients.includes(client.address) && client.type != "Server") {
        client.send(JSON.stringify(returnObj));
      }
    }
  });
}

function sendConfigs(json, socket = null) { //Only config controllers
  let obj = {};
  if (typeof json == "object") {
    obj = json;
  } else {
    obj = JSON.parse(json);
  }

  let returnObj = updateHeader(obj);
  coreServer.clients.forEach(function each(client) {
    if (client !== socket && client.readyState === WebSocket.OPEN && client.type == "Config") {
      client.send(JSON.stringify(returnObj));
    }
  });
}

function sendAdmins(json, socket = null) { //Only Admin controllers
  let obj = {};
  if (typeof json == "object") {
    obj = json;
  } else {
    obj = JSON.parse(json);
  }

  let returnObj = updateHeader(obj);
  coreServer.clients.forEach(function each(client) {
    if (client !== socket && client.readyState === WebSocket.OPEN && client.type == "Admin") {
      client.send(JSON.stringify(returnObj));
    }
  });
}

function sendAll(json, socket) { //Send to all
  sendServers(json);
  sendClients(json, socket);
}

function sendSelf(json, socket) {
  let obj = {};
  if (typeof json == "object") {
    obj = json;
  } else {
    obj = JSON.parse(json);
  }
  let returnObj = updateHeader(obj);

  socket.send(JSON.stringify(returnObj));
}

function makeHeader(intType = type, intVersion = version, intLoadTime = loadTime) {
  let header = {};
  header.fromID = myID;
  header.timestamp = new Date().getTime();
  header.version = intVersion;
  header.type = intType;
  header.active = true;
  header.messageID = header.timestamp;
  header.recipients = [
    host
  ];
  return header;
}

function makePacket(json) {
  let payload = {};
  if (typeof json == "object") {
    payload = json;
  } else {
    payload = JSON.parse(json);
  }
  let packet = {};
  let header = makeHeader();
  packet.header = header;
  packet.payload = payload;
  return packet;
}

function updateHeader(json, relayed = true) {
  let msgObj = {};
  if (typeof json == "object") {
    msgObj = JSON.parse(JSON.stringify(json));
  } else {
    msgObj = JSON.parse(json);
  }
  let header = msgObj.header;
  if (relayed == true) {
    let merged = arrayUnique(header.recipients.concat(state.servers.getURLs()));
    header.recipients = merged;
  }
  return msgObj;
}

function sendData(connection, payload) {
  let packet = {};
  let header = makeHeader();
  packet.header = header;
  packet.payload = payload;
  connection.send(JSON.stringify(packet));
}

function arrayUnique(array) {
  var a = array.concat();
  for(var i=0; i<a.length; ++i) {
    for(var j=i+1; j<a.length; ++j) {
      if(a[i] === a[j])
        a.splice(j--, 1);
    }
  }
  return a;
}

function startHTTPS() {
  if (ownHTTPserver) {
    let sslCert;
    let sslKey;

    try {
      sslCert = fs.readFileSync(certPath, { encoding: 'utf8' });
    } catch (e) {
      log("Could not load server SSL certificate", "E");
      process.exit(1);
    }

    try {
      sslKey = fs.readFileSync(keyPath, { encoding: 'utf8' });
    } catch (e) {
      log("Could not load server SSL key", "E");
      process.exit(1);
    }

    const serverHTTPS = createServer({
      cert: sslCert,
      key: sslKey
    });
    return serverHTTPS;
  } else {
    return null;
  }
}

function loadConfig() {
  try {
    config = require(configLocation+'/config.json');
  } catch (e) {
    config = {};
    log("Config could not be loaded, missing file or invalid JSON?", "E");
    log("Creating new config file");

    if (!fs.existsSync(configLocation)){
      fs.mkdirSync(configLocation, { recursive: true });
    }

    let port = reader.question("What port shall the server use: ");
    let host = reader.question("What url/IP is the server connected to from: ");
    let serverName = reader.question("Please name this server: ");
    let loggingLevel = reader.question("What logging level would you like? (A)ll (D)ebug (W)arnings (E)rror: ");
    let debugLineNum = reader.question("Would you like to print line numbers in the logs? true/false: ");
    let createLogFile = reader.question("Would you like to write the log to a file? true/false: ");
    let otherHost = reader.question("If possible provide the url/ip of another server in the network: ");
    let ownHTTPserver = reader.question("Should this sever be it's own https server? true/false: ");
    if (ownHTTPserver == true) {
      let certPath = reader.question("Path to SSL certificate (normally .pem) eg. /keys/cert.pem: ");
      let keyPath = reader.question("Path to SSL key (normally .key) eg. /keys/cert.key: ");
    }

    config = {
      "port":port,
      "host":host,
      "serverName":serverName,
      "loggingLevel":loggingLevel,
      "debugLineNum":debugLineNum,
      "createLogFile":createLogFile,
      "ownHTTPserver":ownHTTPserver,
      "dataBase":false,
      "otherServers":[]
    };
    if (otherHost !== "") {
      config.otherServers[0] = otherHost;
    }
    if (ownHTTPserver == true) {
      config.certPath = certPath;
      config.keyPath = keyPath;
    }
    fs.writeFile(configLocation+'/config.json', JSON.stringify(config), err => {
      if (err) {
        log("Could not write config file, running with entered details anyway", "E");
      }
    });
  }

  if (typeof argLoggingLevel !== "undefined") {
    loggingLevel = argLoggingLevel;
  } else if (typeof config.loggingLevel !== "undefined") {
    loggingLevel = config.loggingLevel;
  } else {
    loggingLevel = "W"; //(A)LL,(D)EBUG,(W)ARN,(E)RROR
  }

  if (typeof config.debugLineNum !== "undefined") {
    debugLineNum = config.debugLineNum;
  } else {
    debugLineNum = false;
  }

  if (typeof config.port !== "undefined") {
    port = config.port;
  } else {
    port = 443;
  }

  if (typeof config.serverName !== "undefined") {
    serverName = config.serverName;
  } else {
    serverName = "WebTally Server v4";
  }

  if (typeof config.createLogFile !== "undefined") {
    createLogFile = config.createLogFile;
  } else {
    createLogFile = true;
  }

  if (typeof config.host !== "undefined") {
    host = config.host;
  } else {
    host = 443;
  }

  if (typeof config.ownHTTPserver !== "undefined") {
    ownHTTPserver = config.ownHTTPserver;
  } else {
    ownHTTPserver = false;
  }

  if (typeof config.certPath !== "undefined") {
    certPath = config.certPath;
  } else {
    certPath = "keys/"+host+".pem";
  }

  if (typeof config.keyPath !== "undefined") {
    keyPath = config.keyPath;
  } else {
    keyPath = "keys/"+host+".key";
  }

  if (typeof config.dataBase !== "undefined") {
    dataBase = config.dataBase;
  } else {
    dataBase = false;
  }

  if (typeof config.otherServers !== "undefined") {
    for (var i = 0; i < config.otherServers.length; i++) {
      let entry = config.otherServers[i];
      state.servers.add(entry);
    }
  }

  log(`WebTally server running on port: \x1b[33m${port}\x1b[37m`);
  switch (loggingLevel) {
    case "A":
      log("Logging set to \x1b[33mAll\x1b[37m");
      break;
    case "D":
      log("Logging set to \x1b[33mDebug\x1b[37m");
      break;
    case "W":
      log("Logging set to \x1b[33mWarning\x1b[37m & \x1b[33mError\x1b[37m");
      break;
    case "E":
      log("Logging set to \x1b[33mError\x1b[37m only");
      break;
    default:
  }

  log("Show line number in logs set to: "+debugLineNum);

  let today = new Date();
  let dd = String(today.getDate()).padStart(2, '0');
  let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
  let yyyy = today.getFullYear();

  let fileName = `${configLocation}/tallyServer-[${yyyy}-${mm}-${dd}].log`;
  log(`Logging to file: \x1b[33m${fileName}\x1b[37m`);

  if (typeof config.dataBase !== "undefined" && config.dataBase !== false) {
    log(`Setting up \x1b[33mwith\x1b[37m database connection`, "C");
    //Database connection code here
  } else {
    log(`Running \x1b[33mwithout\x1b[37m database connection`, "C");
  }
}

function printHeader() {
  console.log("                                                                  ");
  console.log(" __          __    _   _______      _  _                   _  _   ");
  console.log(" \\ \\        / /   | | |__   __|    | || |                 | || |  ");
  console.log("  \\ \\  /\\  / /___ | |__  | |  __ _ | || | _   _    __   __| || |_ ");
  console.log("   \\ \\/  \\/ // _ \\| '_ \\ | | / _` || || || | | |   \\ \\ / /|__   _|");
  console.log("    \\  /\\  /|  __/| |_) || || (_| || || || |_| |    \\ V /    | |  ");
  console.log("     \\/  \\/  \\___||_.__/ |_| \\__,_||_||_| \\__, |     \\_/     |_|  ");
  console.log("                                           __/ |                  ");
  console.log("                                          |___/                   ");
  console.log("                                                                  ");

  logFile("                                                                  ");
  logFile(" __          __    _   _______      _  _                   _  _   ");
  logFile(" \\ \\        / /   | | |__   __|    | || |                 | || |  ");
  logFile("  \\ \\  /\\  / /___ | |__  | |  __ _ | || | _   _    __   __| || |_ ");
  logFile("   \\ \\/  \\/ // _ \\| '_ \\ | | / _` || || || | | |   \\ \\ / /|__   _|");
  logFile("    \\  /\\  /|  __/| |_) || || (_| || || || |_| |    \\ V /    | |  ");
  logFile("     \\/  \\/  \\___||_.__/ |_| \\__,_||_||_| \\__, |     \\_/     |_|  ");
  logFile("                                           __/ |                  ");
  logFile("                                          |___/                   ");
  logFile("                                                                  ");
}

function loadArgs() {
  if (typeof args[0] !== "undefined") {
    if (args[0] == ".") {
      args[0] = "";
    }
    configLocation = __dirname+args[0];
  } else {
    configLocation = __dirname;
  }

  if (typeof args[1] !== "undefined") {
    argLoggingLevel = args[1];
  }
}

function log(message, level) {
  let e = new Error();
  let stack = e.stack.toString().split(/\r\n|\n/);
  let lineNum = '('+stack[2].substr(stack[2].indexOf("server.js:")+10);
  let timeNow = new Date();
  let hours = String(timeNow.getHours()).padStart(2, "0");
  let minutes = String(timeNow.getMinutes()).padStart(2, "0");
  let seconds = String(timeNow.getSeconds()).padStart(2, "0");
  let millis = String(timeNow.getMilliseconds()).padStart(3, "0");

  let timeString = `${hours}:${minutes}:${seconds}.${millis}`;

  if (typeof message === "undefined") {
    log(`Log message from line \x1b[35m${lineNum}\x1b[0m is not defined`, "E");
    return;
  } else if (typeof message !== "string") {
    log(`Log message from line \x1b[35m${lineNum}\x1b[0m is not a string so attemping to stringify`, "A");
    try {
      message = JSON.stringify(message, null, 4);
    } catch (e) {
      log(`Log message from line \x1b[35m${lineNum}\x1b[0m could not be converted to string`, "E");
    }
  }

  if (!debugLineNum) {
    lineNum = "";
  }

  message = message.replace(/true/g, "\x1b[32mtrue\x1b[37m");
  message = message.replace(/false/g, "\x1b[31mfalse\x1b[37m");
  message = message.replace(/null/g, "\x1b[33mnull\x1b[37m");
  message = message.replace(/undefined/g, "\x1b[33mundefined\x1b[37m");

  const regexp = / \((.*?):(.[0-9]*):(.[0-9]*)\)"/g;
  let matches = message.matchAll(regexp);
  for (let match of matches) {
    message = message.replace(match[0],`" [\x1b[33m${match[1]}\x1b[0m] \x1b[35m(${match[2]}:${match[3]})\x1b[0m`);
  }

  switch (level) {
    case "A":
      if (loggingLevel == "A") {
        logFile(`[${timeString}]  INFO: ${message} ${lineNum}`);//White
        console.log(`[${timeString}]\x1b[37m  INFO:\x1b[2m ${message}\x1b[1m \x1b[35m${lineNum}\x1b[0m`);
      }
      break;
    case "D":
      if (loggingLevel == "A" || loggingLevel == "D") {
        logFile(`[${timeString}] DEBUG: ${message} ${lineNum}`);//Cyan
        console.log(`[${timeString}]\x1b[36m DEBUG:\x1b[37m ${message} \x1b[35m${lineNum}\x1b[0m`);
      }
      break;
    case "W":
      if (loggingLevel != "E") {
        logFile(`[${timeString}]  WARN: ${message} ${lineNum}`);//Yellow
        console.log(`[${timeString}]\x1b[33m  WARN:\x1b[37m ${message} \x1b[35m${lineNum}\x1b[0m`);
      }
      break;
    case "E":
      logFile(`[${timeString}] ERROR: ${message} ${lineNum}`);//Red
      console.log(`[${timeString}]\x1b[31m ERROR:\x1b[37m ${message} \x1b[35m${lineNum}\x1b[0m`);
      break;
    case "S":
      logFile(`[${timeString}] NETWK: ${message} ${lineNum}`);//Blue
      console.log(`[${timeString}]\x1b[34m NETWK:\x1b[37m ${message} \x1b[35m${lineNum}\x1b[0m`);
      break;
    default:
      logFile(`[${timeString}]  CORE: ${message} ${lineNum}`);//Green
      console.log(`[${timeString}]\x1b[32m  CORE:\x1b[37m ${message} \x1b[35m${lineNum}\x1b[0m`);
  }
}

function logFile(msg) {
  if (createLogFile) {
    let dir = `${configLocation}/logs`;

    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
    }

    let today = new Date();
    let dd = String(today.getDate()).padStart(2, '0');
    let mm = String(today.getMonth() + 1).padStart(2, '0');
    let yyyy = today.getFullYear();

    let fileName = `${dir}/tallyServer-[${yyyy}-${mm}-${dd}].log`;
    let data = msg.replaceAll("\x1b[32m", "").replaceAll("\x1b[0m", "").replaceAll("\x1b[31m","").replaceAll("\x1b[37m", "").replaceAll("\x1b[33m", "").replaceAll("\x1b[35m", "")+"\n";
    fs.appendFile(fileName, data, err => {
      if (err) {
        createLogFile = false;
        log("Could not write to log file, permissions?", "E");
      }
    });
  }
}
