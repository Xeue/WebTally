#!/usr/bin/env node
/*jshint esversion: 6 */
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';
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

let configLocation = __dirname;
let port = 443;
let host;
let loggingLevel = "W";
let debugLineNum = false;
let createLogFile = true;
let argLoggingLevel;
let dataBase;

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

printHeader();

let config;
try {
  config = require(configLocation+'/config.json');
} catch (e) {
  config = {};
  log("Config could not be loaded, missing file or invalid JSON?", "E");
  log("Creating new config file");

  let port = reader.question("What port shall the server use: ");
  let host = reader.question("What url/IP is the server connected to from: ");
  let loggingLevel = reader.question("What logging level would you like? (A)ll (D)ebug (W)arnings (E)rror: ");
  let debugLineNum = reader.question("Would you like to print line numbers in the logs? true/false: ");
  let createLogFile = reader.question("Would you like to write the log to a file? true/false: ");
  let otherHost = reader.question("If possible provide the url/ip of another server in the network: ");

  config = {
    "port":port,
    "host":host,
    "loggingLevel":loggingLevel,
    "debugLineNum":debugLineNum,
    "createLogFile":createLogFile,
    "dataBase":false,
    "otherServers":[]
  };
  if (otherHost !== "") {
    config.otherServers[0] = otherHost;
  }
  fs.writeFile(configLocation+'/config.json', JSON.stringify(config), err => {
    if (err) {
      log("Could not write config file, running with entered details anyway", "E");
    }
  });

}

let otherServers = {};
otherServers.trimmed = function() {
  let otherServersTrimmed = {};
  for (var server in otherServers) {
    if (otherServers.hasOwnProperty(server) && typeof otherServers[server] !== 'function') {
      otherServersTrimmed[server] = {};
      otherServersTrimmed[server].active = otherServers[server].active;
      otherServersTrimmed[server].connected = otherServers[server].connected;
    }
  }
  return otherServersTrimmed;
};
otherServers.list = function() {
  let otherServersList = [];
  for (var server in otherServers) {
    if (otherServers.hasOwnProperty(server) && typeof otherServers[server] !== 'function' && otherServers[server].connected == true) {
      otherServersList.push(server);
    }
  }
  return otherServersList;
};

loadConfig(config);

let state = {};
state = setUpStates(state);

let version = "4.0";
let type = "Server";
let loadTime = new Date().getTime();

const coreServer = new WebSocketServer({ port: port });

setupOtherServers();

// 5 Second ping loop
setInterval(() => {
  doPing();
  setupOtherServers();
}, 5000);

// 1 Minute ping loop
setInterval(() => {
  setupOtherServers(true);
}, 60000);


// Main websocket server
coreServer.on('connection', function connection(socket) {
  log("New connection established, sending it other severs list", "D");

  // Sending server list

  let payload = {};
  payload.command = "server";
  payload.servers = otherServers.trimmed();
  sendData(socket, payload);

  socket.pingStatus = "alive";

  //save to DB here

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
              log(hObj.fromID+' - Registered as new config controller', "D");
              break;
            case "Server":
                let address = pObj.address;
                socket.address = address;
                log("\x1b[32m"+hObj.fromID+'\x1b[0m Registered as new server', "D");
                log("\x1b[32m"+address+"\x1b[0m Registered as new inbound server connection", "S");
                if (!otherServers.hasOwnProperty(address)) {
                  log("Adding new address: "+address, "D");
                  otherServers[address] = {"socket":null,"active":true,"connected":false,"attempts":0};
                  updateClientServerList();
                } else {
                  log("Address already registered", "D");
                }
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
            if (!otherServers.hasOwnProperty(server) && server != host) {
              otherServers[server] = {"socket":null,"active":true,"connected":false,"attempts":0};
              updateClientServerList();
            }
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
          log("Server error - "+e, "E");
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

function setUpStates(state) {
  let fileNameTally = configLocation+"/tallyState.json";

  state.tally = {};
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

  fs.readFile(fileNameTally, function(err, data) {
    if (typeof data !== "undefined") {
      state.tally.data = JSON.parse(data);
    } else {
      state.tally.data = {"default":{"main":{}}};
    }
    if (err) {
      log("Could not read tally state from file, either invalid permissions or it doesn't exist yet", "W");
    }
  });

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

function setupOtherServers(retry = false) {
  for (let server in otherServers) {
    if (otherServers.hasOwnProperty(server) && typeof otherServers[server] !== 'function') {
      let thisServer = otherServers[server];
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
          sendData(outbound, payload);
          log("\x1b[32m"+server+"\x1b[0m Established as new outbound server connection", "S");
          thisServer.connected = true;
          thisServer.attempts = 0;
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
                  if (!otherServers.hasOwnProperty(server) && server != host) {
                    otherServers[server] = {"socket":null,"active":true,"connected":false,"attempts":0};
                    updateClientServerList();
                  }
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
              if (typeof msgObj.type !== "undefined") {
                log("A device on a different server is using old tally format, upgrade it to v4.0 or above", "W");
              }
              log("Invalid JSON from other server - "+e, "E");
            } catch (e2) {
              log("Malformed JSON from other server - "+e, "E");
            }
          }
        });

        outbound.on('close', function close() {
          thisServer.connected = false;
          thisServer.socket = null;
          thisServer.attempts++;
          if (!inError) {
            log("Disconnected from server: \x1b[31m"+server+"\x1b[0m", "W");
            updateClientServerList();
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

function updateClientServerList() {
  log("Sending updated server list to clients", "D");
  let payload = {};
  payload.command = "server";
  payload.servers = otherServers.trimmed();

  coreServer.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
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
  for (var server in otherServers) {
    if (otherServers.hasOwnProperty(server) && otherServers[server].connected == 1) {
      if (!recipients.includes(server)) {
        otherServers[server].socket.send(JSON.stringify(returnObj));
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
  header.fromID = "S_"+intLoadTime+"_"+version;
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
    let merged = arrayUnique(header.recipients.concat(otherServers.list()));
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

function loadConfig(configObj) {
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

  if (typeof config.dataBase !== "undefined") {
    dataBase = config.dataBase;
  } else {
    dataBase = false;
  }

  if (typeof config.otherServers !== "undefined") {
    for (var i = 0; i < config.otherServers.length; i++) {
      let entry = config.otherServers[i];
      otherServers[entry] = {
        "socket":null,
        "active":true,
        "connected":false,
        "attempts":0
      };
    }
  }

  log("WebTally server running on port: "+port);
  switch (loggingLevel) {
    case "A":
      log("Logging set to All");
      break;
    case "D":
      log("Logging set to Debug");
      break;
    case "W":
      log("Logging set to Warning & Error");
      break;
    case "E":
      log("Logging set to Error only");
      break;
    default:
  }

  log("Show line number in logs set to: "+debugLineNum);

  let today = new Date();
  let dd = String(today.getDate()).padStart(2, '0');
  let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
  let yyyy = today.getFullYear();

  let fileName = `${configLocation}/tallyServer-[${yyyy}-${mm}-${dd}].log`;
  log("Logging to file: "+fileName);

  if (typeof config.dataBase !== "undefined" && config.dataBase !== false) {
    log("Setting up database connection", "C");
    //Database connection code here
  } else {
    log("Running without database connection", "C");
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

function log(message, level) {
  let e = new Error();
  let stack = e.stack.toString().split(/\r\n|\n/);
  let lineNum;
  if (debugLineNum) {
    lineNum = '('+stack[2].substr(stack[2].indexOf("server.js:")+10);
  } else {
    lineNum = "";
  }

  let timeNow = new Date();
  let hours = String(timeNow.getHours()).padStart(2, "0");
  let minutes = String(timeNow.getMinutes()).padStart(2, "0");
  let seconds = String(timeNow.getSeconds()).padStart(2, "0");
  let millis = String(timeNow.getMilliseconds()).padStart(3, "0");

  let timeString = `${hours}:${minutes}:${seconds}.${millis}`;

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
    let today = new Date();
    let dd = String(today.getDate()).padStart(2, '0');
    let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
    let yyyy = today.getFullYear();

    let fileName = `${configLocation}/tallyServer-[${yyyy}-${mm}-${dd}].log`;
    let data = msg.replace("\x1b[32m", "").replace("\x1b[0m", "").replace("\x1b[31m","")+"\n";
    fs.appendFile(fileName, data, err => {
      if (err) {
        createLogFile = false;
        log("Could not write to log file, permissions?", "E");
      }
    });
  }
}
