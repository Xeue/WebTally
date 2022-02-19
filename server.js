#!/usr/bin/env node
/*jshint esversion: 6 */
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';
import { createServer } from 'https';
import { createRequire } from "module";
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const reader = require("readline-sync");

const args = process.argv.slice(2);
const version = "4.2";
const type = "Server";
const loadTime = new Date().getTime();

let myID = `S_${loadTime}_${version}`;
let configLocation = __dirname;
let port = 443;
let host;
let loggingLevel = "W";
let debugLineNum = true;
let createLogFile = true;
let argLoggingLevel;
let ownHTTPserver = true;
let dataBase;
let certPath;
let keyPath;
let serverName = "WebTally Server v4";
let printPings = false;

let r = "\x1b[31m";
let g = "\x1b[32m";
let y = "\x1b[33m";
let b = "\x1b[34m";
let p = "\x1b[35m";
let c = "\x1b[36m";
let w = "\x1b[37m";
let reset = "\x1b[0m";
let dim = "\x1b[2m";
let bright = "\x1b[1m";

let config;

var coreServer;
var serverHTTPS;

loadArgs();

let state = setUpStates();

loadConfig();

startServer();

startLoops();

function startServer() {
  if (ownHTTPserver) {
    coreServer = new WebSocketServer({ noServer: true });

    serverHTTPS = startHTTPS();
    log("Running as own HTTPS server and hosting UI internally");
  } else {
    log(`Running as ${y}standalone${w} websocket server`);
    coreServer = new WebSocketServer({ port: port });
  }
  log("Started Websocket server");

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
      let msgObj = {};
      let pObj;
      let hObj;
      try {
        msgObj = JSON.parse(msgJSON);
        if (msgObj.payload.command !== "ping" && msgObj.payload.command !== "pong") {
          logObj('Received', msgObj, "A");
        } else if (printPings == true) {
          logObj('Received', msgObj, "A");
        }
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
            coreDoRegister(socket, msgObj);
            break;
          case "disconnect":
            log(`${r}${pObj.data.ID}${reset} Connection closed`, "D");
            state.clients.remove(pObj.data.ID);
            sendConfigs(msgObj, socket);
            sendServers(msgObj);
            break;
          case "tally":
            log("Recieved tally data", "D");
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
            coreDoCommand(socket, msgObj);
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
          case "clients":
            state.clients.addAll(pObj.clients);
            log("Recieved clients list from other server", "D");
            break;
          case "error":
            log(`Device ${hObj.fromID} has entered an error state`, "E");
            log(`Message: ${pObj.error}`, "E");
            logObj(`Device ${hObj.fromID} connection details`, state.clients.getDetails(socket), "E");
            break;
          default:
            log("Unknown message: "+msgJSON, "W");
            sendAll(msgObj);
        }
      } catch (e) {
        try {
          msgObj = JSON.parse(msgJSON);
          if (msgObj.payload.command !== "ping" && msgObj.payload.command !== "pong") {
            logObj('Received', msgObj, "A");
          } else if (printPings == true) {
            logObj('Received', msgObj, "A");
          }
          if (typeof msgObj.type == "undefined") {
            let stack = e.stack.toString().split(/\r\n|\n/);
            stack = JSON.stringify(stack, null, 4);
            log(`Server error, stack trace: ${stack}`, "E");
          } else {
            log("A device is using old tally format, upgrade it to v4.0 or above", "E");
          }
        } catch (e2) {
          log("Invalid JSON - "+e, "E");
          log('Received: '+msgJSON, "A");
        }
      }
    });

    socket.on('close', function() {
      try {
        let oldId = JSON.parse(JSON.stringify(socket.ID));
        log(`${r}${oldId}${reset} Connection closed`, "D");
        socket.connected = false;
        if (socket.type == "Server") {
          log(`${r}${socket.address}${reset} Inbound connection closed`, "W");
        } else {
          state.clients.remove(oldId);
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
    serverHTTPS.listen(port);
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

function setUpStates() {
  let dir = `${configLocation}/states`;
  let fileNameTally = dir+"/tallyState.json";
  let fileNameServers = dir+"/serversState.json";
  let fileNameClients = dir+"/clientsState.json";
  let fileNameProperties = dir+"/server.properties";

  // State functions defined here
  let state = {
    "tally":{
      "data":{},
      update(busses, source = "default") {
        let savedBusses = this.data[source];

        for (let busName in busses) {
          if (busses.hasOwnProperty(busName)) {
            let bus = busses[busName];
            for (var camNum in bus) {
              if (bus.hasOwnProperty(camNum)) {
                let cam = bus[camNum];

                if (typeof savedBusses[busName] == "undefined") {
                  this.newBus(busName, source);
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
          let data = JSON.stringify(this.data);
          fs.writeFile(fileNameTally, data, err => {
            if (err) {
              log("Could not save tally state to file, permissions?", "W");
            }
          });
        } else {
          log("Not implemented yet - database connection", "W");
        }

      },
      newSoruce(source) {
        this.data[source] = {
          "busses":{
            "main":{}
          }
        };
      },
      newBus(busName, source = "default") {
        if (typeof this.data[source] == "undefined") {
          this.newSoruce(source);
        }
        this.data[source][busName] = {};
      },
      updateClients(socket = null) {
        setTimeout(function() {
          for (var source in this.data) {
            if (this.data.hasOwnProperty(source)) {
              let payload = {};
              payload.busses = {};
              payload.busses = this.data[source];
              payload.command = "tally";
              payload.source = source;
              let packet = makePacket(payload);
              if (socket == null) {
                sendClients(packet);
              } else {
                socket.send(JSON.stringify(packet));
              }
            }
          }
        },100);
      },
      updateServer(socket) {
        setTimeout(function() {
          for (var source in this.data) {
            if (this.data.hasOwnProperty(source)) {
              let payload = {};
              payload.busses = {};
              payload.busses = this.data[source];
              payload.command = "tally";
              payload.source = source;
              let packet = makePacket(payload);
              socket.send(JSON.stringify(packet));
            }
          }
        },100);
      },
      clean() {
        log("Clearing tally states");
        this.data = {};
        fs.unlink(fileNameTally, (err) => {
          if (err) {
            log("Could not remove tally states file, it either didn't exists or permissions?", "W");
          } else {
            log("Cleared tally states");
          }
        });
      }
    },
    "servers":{
      "data":{},
      add(url, header, name) {
        if (!this.data.hasOwnProperty(url) && url !== host) {
          log("Adding new address: "+url, "D");
          this.data[url] = {
            "socket":null,
            "active":true,
            "connected":false,
            "attempts":0,
            "version":null,
            "ID":null,
            "Name":`Webtally v4 server`
          };
          if (typeof header !== "undefined") {
            this.data[url].version = header.version;
            this.data[url].ID = header.fromID;
            if (typeof name !== "undefined") {
              this.data[address].Name = name;
            } else {
              this.data[address].Name = `Webtally v${header.version} server`;
            }
          }
          connectToOtherServers();
          if (coreServer) {
            sendServerListToClients();
          }
        } else if (url !== host) {
          log("Address already registered", "D");
          if (typeof this.data[url].active === false) {
            this.data[url].active = true;
            connectToOtherServers();
          }
        }

        this.save();
      },
      update(address, header, name) {
        if (this.data.hasOwnProperty(address) && address !== host) {
          log("Updating server details for: "+address, "D");
          this.data[address].version = header.version;
          this.data[address].ID = header.fromID;
          if (typeof name !== "undefined") {
            this.data[address].Name = name;
          } else {
            this.data[address].Name = `Webtally v${header.version} server`;
          }
          let payload = {};
          payload.command = "server";
          payload.servers = this.getDetails(address, true);
          sendAdmins(makePacket(payload));
          sendServerListToClients();
        } else {
          log("Address not registered, adding: "+address, "D");
          this.add(address, header, name);
        }

        this.save();
      },
      remove(url) {
        if (this.data.hasOwnProperty(url)) {
          log(`Removing address and closing outbound connection to: ${y}${url}${reset}`, "D");
          try {
            this.data[url].socket.close();
          } catch (e) {
            log("Server connection already closed","W");
          }
          delete this.data[url];
        }

        coreServer.clients.forEach(function each(client) {
          if (client.address == url && client.readyState === WebSocket.OPEN) {
            client.terminate();
          }
        });

        let payload = {};
        payload.command = "server";
        payload.servers = this.getDetails(url, true);
        sendAdmins(makePacket(payload));
        this.save();
      },
      getURLs(print = false) {
        let serverDataList = [];
        let serverData = this.data;
        for (var server in serverData) {
          if (serverData.hasOwnProperty(server) && typeof serverData[server] !== 'function' && serverData[server].connected == true) {
            serverDataList.push(server);
          }
          if (print) {
            log(`${server} - Connected: ${serverData[server].connected} Active: ${serverData[server].active}`,"S");
          }
        }
        return serverDataList;
      },
      getStatus(print = false) {
        let serverDataTrimmed = {};
        let serverData = this.data;
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
      },
      getDetails(server = "ALL", print = false) {
        let details = {};
        if (server == "ALL") {
          for (var data in this.data) {
            if (this.data.hasOwnProperty(data)) {
              details[data] = {};
              details[data].socket = "SOCKET OBJECT";
              details[data].active = this.data[data].active;
              details[data].connected = this.data[data].connected;
              details[data].attempts = this.data[data].attempts;
              details[data].version = this.data[data].version;
              details[data].ID = this.data[data].ID;
              details[data].Name = this.data[data].Name;
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
        } else if (server == host) {
          details = this.getThisServer();
        } else {
          if (typeof this.data[server] !== "undefined") {
            details[server] = {};
            details[server].socket = "SOCKET OBJECT";
            details[server].active = this.data[server].active;
            details[server].connected = this.data[server].connected;
            details[server].attempts = this.data[server].attempts;
            details[server].version = this.data[server].version;
            details[server].ID = this.data[server].ID;
            details[server].Name = this.data[server].Name;
          }
        }
        if (print === true) {
          logObj("Server details", details, "A");
        } else if (print == "S") {
          logObj("Server details", details, "S");
        }
        return details;
      },
      getThisServer() {
        let thisServer = {
          "socket": "SOCKET OBJECT",
          "active":true,
          "connected":true,
          "attempts":0,
          "version":version,
          "ID":myID,
          "Name":serverName
        };
        return thisServer;
      },
      save() {
        if (dataBase === false) {
          let data = JSON.stringify(this.getDetails("ALL", true));
          fs.writeFile(fileNameServers, data, err => {
            if (err) {
              log("Could not save servers state to file, permissions?", "W");
            }
          });
        } else {
          log("Not implemented yet - database connection", "W");
        }
      },
      clean() {
        log("Clearing server states");
        let servers = this.getURLs();
        for (var i = 0; i < servers.length; i++) {
          this.remove(servers[i]);
        }
        this.data = {};
        fs.unlink(fileNameServers, (err) => {
          if (err) {
            log("Could not remove server states file, it either didn't exists or permissions?", "W");
          } else {
            log("Cleared server states");
          }
        });
      }
    },
    "clients":{
      "data":{},
      add(msgObj, socket) {
        let hObj = msgObj.header;
        let pObj = msgObj.payload;
        let clientsData = this.data;
        let clientData;
        if (hObj.type != "Server") {
          if (hObj.fromID == socket.ID) {
            clientsData[socket.ID] = {};
            clientData = clientsData[socket.ID];
            clientData.camera = socket.camera;
            clientData.connected = socket.connected;
            clientData.type = socket.type;
            clientData.version = socket.version;
            clientData.local = true;
            clientData.pingStatus = socket.pingStatus;
            clientData.socket = socket;
          } else {
            clientsData[hObj.fromID] = {};
            clientData = clientsData[hObj.fromID];
            clientData.camera = pObj.camera;
            clientData.connected = hObj.active;
            clientData.type = hObj.type;
            clientData.version = hObj.version;
            clientData.local = false;
          }
        }
        this.save();
      },
      addAll(clients) {
        let clientsData = this.data;
        for (var client in clients) {
          if (clients.hasOwnProperty(client) && !clientsData.hasOwnProperty(client)) {
            clientsData[client] = {};
            clientsData[client].camera = clients[client].camera;
            clientsData[client].connected = clients[client].active;
            clientsData[client].type = clients[client].type;
            clientsData[client].version = clients[client].version;
            clientsData[client].local = false;
          }
        }
      },
      update(msgObj, socket) {
        let hObj = msgObj.header;
        let pObj = msgObj.payload;
        let clientsData = this.data;
        let clientData;
        if (hObj.type != "Server") {
          if (typeof clientsData[hObj.fromID] == "undefined") {
            this.add(msgObj, socket);
          } else if (hObj.fromID == socket.ID) {
            clientsData[socket.ID] = {};
            clientData = clientsData[socket.ID];
            clientData.camera = socket.camera;
            clientData.connected = socket.connected;
            clientData.type = socket.type;
            clientData.version = socket.version;
            clientData.local = true;
            clientData.pingStatus = socket.pingStatus;
            clientData.socket = socket;
          } else {
            clientsData[hObj.fromID] = {};
            clientData = clientsData[hObj.fromID];
            clientData.camera = pObj.camera;
            clientData.connected = hObj.active;
            clientData.type = hObj.type;
            clientData.version = hObj.version;
            clientData.local = false;
          }
        }
      },
      remove(socket) {
        let clientsData = this.data;
        if (typeof socket == "string") {
          if (typeof clientsData[socket] !== "undefined" && clientsData[socket].local == true) {
            clientsData[socket].socket.terminate();
            delete clientsData[socket];
          } else {
            delete clientsData[socket];
          }
        } else {
          if (socket.type != "Server" && socket.type != "Config" && socket.type != "Admin") {
            if (typeof clientsData[socket.ID] !== "undefined" && clientsData[socket.ID].local == true) {
              delete clientsData[socket.ID];
              socket.terminate();
            } else {
              delete clientsData[socket.ID];
            }
          }
        }
        this.save();
      },
      getDetails(socket = "ALL", print = false) {
        let clientsData = this.data;
        let details = {};
        if (socket == "ALL") {
          for (var client in clientsData) {
            if (clientsData.hasOwnProperty(client)) {
              details[client] = {};
              details[client].camera = clientsData[client].camera;
              details[client].connected = clientsData[client].connected;
              details[client].type = clientsData[client].type;
              details[client].version = clientsData[client].version;
              details[client].local = clientsData[client].local;
              if (clientsData[client].local == true) {
                details[client].pingStatus = clientsData[client].pingStatus;
                details[client].socket = "SOCKET OBJECT";
              }
            }
          }
          if (print === true) {
            log("Clients details", details, "A");
          } else if (print == "S") {
            logObj("Clients details", details, "S");
          }
        } else if (typeof clientsData[socket.ID] !== "undefined") {
          details[socket.ID].camera = clientsData[socket.ID].camera;
          details[socket.ID].connected = clientsData[socket.ID].connected;
          details[socket.ID].type = clientsData[socket.ID].type;
          details[socket.ID].version = clientsData[socket.ID].version;
          if (clientData.local == true) {
            details[socket.ID].pingStatus = clientsData[socket.ID].pingStatus;
            details[socket.ID].socket = "SOCKET OBJECT";
          }
          if (print) {
            log("Clients details: "+JSON.stringify(details, null, 4), "A");
          }
        } else {
          details = false;
        }
        return details;
      },
      save() {
        if (dataBase === false) {
          let data = JSON.stringify(this.getDetails("ALL"));
          fs.writeFile(fileNameClients, data, err => {
            if (err) {
              log("Could not save clients state to file, permissions?", "W");
            }
          });
        } else {
          log("Not implemented yet - database connection", "W");
        }
      },
      clean() {
        log("Clearing clients states");
        this.data = {};
        fs.unlink(fileNameClients, (err) => {
          if (err) {
            log("Could not remove client states file, it either didn't exists or permissions?", "W");
          } else {
            log("Cleared clients states");
          }
        });
      }
    },
    "mixer":{
      "data":{},
      add(msgObj, socket) {
        let hObj = msgObj.header;
        let pObj = msgObj.payload;
        let mixersData = this.data;
        let mixerData;
        if (hObj.type != "Server") {
          if (hObj.fromID == socket.ID) {
            mixersData[socket.ID] = {};
            mixerData = mixersData[socket.ID];
            mixerData.camera = socket.camera;
            mixerData.connected = socket.connected;
            mixerData.type = socket.type;
            mixerData.version = socket.version;
            mixerData.local = true;
            mixerData.pingStatus = socket.pingStatus;
            mixerData.socket = socket;
          } else {
            mixersData[hObj.fromID] = {};
            mixerData = mixersData[hObj.fromID];
            mixerData.camera = pObj.camera;
            mixerData.connected = hObj.active;
            mixerData.type = hObj.type;
            mixerData.version = hObj.version;
            mixerData.local = false;
          }
        }
        this.save();
      },
      addAll(mixers) {
        let mixersData = this.data;
        for (var mixer in mixers) {
          if (mixers.hasOwnProperty(mixer) && !mixersData.hasOwnProperty(mixer)) {
            mixersData[mixer] = {};
            mixersData[mixer].camera = mixers[mixer].camera;
            mixersData[mixer].connected = mixers[mixer].active;
            mixersData[mixer].type = mixers[mixer].type;
            mixersData[mixer].version = mixers[mixer].version;
            mixersData[mixer].local = false;
          }
        }
      },
      update(msgObj, socket) {
        let hObj = msgObj.header;
        let pObj = msgObj.payload;
        let mixersData = this.data;
        let mixerData;
        if (hObj.type != "Server") {
          if (typeof mixersData[hObj.fromID] == "undefined") {
            this.add(msgObj, socket);
          } else if (hObj.fromID == socket.ID) {
            mixersData[socket.ID] = {};
            mixerData = mixersData[socket.ID];
            mixerData.camera = socket.camera;
            mixerData.connected = socket.connected;
            mixerData.type = socket.type;
            mixerData.version = socket.version;
            mixerData.local = true;
            mixerData.pingStatus = socket.pingStatus;
            mixerData.socket = socket;
          } else {
            mixersData[hObj.fromID] = {};
            mixerData = mixersData[hObj.fromID];
            mixerData.camera = pObj.camera;
            mixerData.connected = hObj.active;
            mixerData.type = hObj.type;
            mixerData.version = hObj.version;
            mixerData.local = false;
          }
        }
      },
      remove(socket) {
        let mixersData = this.data;
        if (typeof socket == "string") {
          if (typeof mixersData[socket] !== "undefined" && mixersData[socket].local == true) {
            mixersData[socket].socket.terminate();
            delete mixersData[socket];
          } else {
            delete mixersData[socket];
          }
        } else {
          if (socket.type != "Server" && socket.type != "Config" && socket.type != "Admin") {
            if (typeof mixersData[socket.ID] !== "undefined" && mixersData[socket.ID].local == true) {
              delete mixersData[socket.ID];
              socket.terminate();
            } else {
              delete mixersData[socket.ID];
            }
          }
        }
        this.save();
      },
      getDetails(socket = "ALL", print = false) {
        let mixersData = this.data;
        let details = {};
        if (socket = "ALL") {
          for (var mixer in mixersData) {
            if (mixersData.hasOwnProperty(mixer)) {
              details[mixer] = {};
              details[mixer].camera = mixersData[mixer].camera;
              details[mixer].connected = mixersData[mixer].connected;
              details[mixer].type = mixersData[mixer].type;
              details[mixer].version = mixersData[mixer].version;
              details[mixer].local = mixersData[mixer].local;
              if (mixersData[mixer].local == true) {
                details[mixer].pingStatus = mixersData[mixer].pingStatus;
                details[mixer].socket = "SOCKET OBJECT";
              }
            }
          }
          if (print === true) {
            log("mixers details", details, "A");
          } else if (print == "S") {
            logObj("mixers details", details, "S");
          }
        } else if (typeof mixersData[socket.ID] !== "undefined") {
          details[socket.ID].camera = mixersData[socket.ID].camera;
          details[socket.ID].connected = mixersData[socket.ID].connected;
          details[socket.ID].type = mixersData[socket.ID].type;
          details[socket.ID].version = mixersData[socket.ID].version;
          if (mixerData.local == true) {
            details[socket.ID].pingStatus = mixersData[socket.ID].pingStatus;
            details[socket.ID].socket = "SOCKET OBJECT";
          }
          if (print) {
            log("mixers details: "+JSON.stringify(details, null, 4), "A");
          }
        } else {
          details = false;
        }
        return details;
      },
      save() {
        if (dataBase === false) {
          let data = JSON.stringify(this.getDetails("ALL"));
          fs.writeFile(fileNamemixers, data, err => {
            if (err) {
              log("Could not save mixers state to file, permissions?", "W");
            }
          });
        } else {
          log("Not implemented yet - database connection", "W");
        }
      },
      clean() {
        log("Clearing mixers states");
        this.data = {};
        fs.unlink(fileNamemixers, (err) => {
          if (err) {
            log("Could not remove mixer states file, it either didn't exists or permissions?", "W");
          } else {
            log("Cleared mixers states");
          }
        });
      }
    }
  };

  if (!fs.existsSync(dir)){
    fs.mkdirSync(dir, { recursive: true });
  }

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
  fs.readFile(fileNameClients, function(err, data) {
    if (typeof data !== "undefined") {
      let clientData = state.clients.data;
      try {
        clientData = JSON.parse(data);
        for (var client in clientData) {
          if (clientData.hasOwnProperty(client)) {
            //clientData[client].socket = null;
            //clientData[client].connected = false;
          }
        }
      } catch (e) {
        log("Could not parse client state data", "W");
      }
    }
    if (err) {
      log("Could not read client state from file, either invalid permissions or it doesn't exist yet", "W");
    }
  });
  fs.readFile(fileNameProperties, function(err, data) {
    if (typeof data !== "undefined") {
      let properties;
      try {
        properties = JSON.parse(data);
        myID = properties.myID;
        log(`Server ID is: ${y}${myID}${w}`);
      } catch (e) {
        log("Could not parse server properties", "W");
        properties = {
          "myID": myID
        };
        fs.writeFile(fileNameProperties, JSON.stringify(properties), err => {
          if (err) {
            log("Could not save server properties to file, permissions?", "W");
          }
        });
      }
    }
    if (err) {
      log("Could not read server properties from file, either invalid permissions or it doesn't exist yet", "W");
      let properties = {
        "myID": myID
      };
      fs.writeFile(fileNameProperties, JSON.stringify(properties), err => {
        if (err) {
          log("Could not save server properties to file, permissions?", "W");
        }
      });
    }
  });

  return state;
}

function doPing() {
  if (printPings !== false) {
    log("Doing ping", "A");
  }
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
  if (printPings !== false) {
    log("Clients alive: "+counts.alive, "A");
    log("Clients dead: "+counts.dead, "A");
  }
}

function coreDoRegister(socket, msgObj) {
  let hObj = msgObj.header;
  let pObj = msgObj.payload;
  if (typeof socket.type == "undefined") {
    socket.type = hObj.type;
  }
  if (typeof socket.ID == "undefined") {
    socket.ID = hObj.fromID;
  }
  if (typeof socket.version == "undefined") {
    socket.version = hObj.version;
  }
  switch (hObj.type) {
    case "Config":
      log(`${g}${hObj.fromID}${reset} Registered as new config controller`, "D");
      sendData(socket, {"command":"clients","clients":state.clients.getDetails()});
      socket.connected = true;
      state.clients.add(msgObj, socket);
      break;
    case "Server":
      let address = pObj.address;
      let name = pObj.name;
      socket.address = address;
      socket.name = name;
      log(`${g}${hObj.fromID}${reset} Registered as new server`, "D");
      log(`${g}${address}${reset} Registered as new inbound server connection`, "S");
      state.servers.add(address);
      state.servers.update(address, hObj, name);
      break;
    case "Admin":
      log(`${g}${hObj.fromID}${reset} Registered as new admin controller`, "D");
      let payload = {};
      payload.command = "server";
      payload.servers = state.servers.getDetails("ALL");
      payload.servers[host] = state.servers.getThisServer();
      socket.connected = true;
      state.clients.add(msgObj, socket);
      sendAdmins(makePacket(payload));
      break;
    case "Mixer":
      log(`${g}${hObj.fromID}${reset} Registered as new vision mixer/GPI controler`, "D");
      socket.connected = true;
      state.mixer.add(msgObj, socket);
      sendConfigs(msgObj, socket);
      sendServers(msgObj);
      break;
    default:
      log(`${g}${hObj.fromID}${reset} Registered as new client`, "D");
      socket.connected = true;
      if (typeof pObj.data.camera !== "undefined") {
        socket.camera = pObj.data.camera;
      }
      state.clients.add(msgObj, socket);
      sendConfigs(msgObj, socket);
      sendServers(msgObj);
      state.tally.updateClients();
  }
}

function coreDoCommand(socket, msgObj) {
  let pObj = msgObj.payload;
  log("A command is being sent to clients", "D");
  if (pObj.serial == myID) {
    log("Command for this server recieved", "D");
    switch (pObj.action) {
      case "clearStates":
        state.tally.clean();
        state.clients.clean();
        state.servers.clean();
        break;
      case "clearTally":
        state.tally.clean();
        break;
      case "clearClients":
        state.clients.clean();
        break;
      case "clearServers":
        state.servers.clean();
        break;
      case "config":
        loadConfig(false);
        break;
      case "printServers":
        state.servers.getDetails("ALL", "S");
        break;
      case "printClients":
        state.clients.getDetails("ALL", "S");
        break;
      default:

    }
  }
  sendAll(msgObj, socket);
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
          log(`Retrying connection to dead server: ${r}${server}${reset}`, "W");
        }
        outbound = new WebSocket("wss://"+server);

        thisServer.socket = outbound;

        outbound.on('open', function open() {
          let payload = {};
          payload.command = "register";
          payload.address = host;
          payload.name = serverName;
          sendData(outbound, payload);
          log(`${g}${server}${reset} Established as new outbound server connection`, "S");
          thisServer.connected = true;
          thisServer.active = true;
          thisServer.attempts = 0;
          payload = {};
          payload.command = "server";
          payload.servers = state.servers.getDetails(server);
          sendAdmins(makePacket(payload));
          sendData(outbound, {"command":"clients","clients":state.clients.getDetails()});
          state.tally.updateServer(outbound);
        });

        outbound.on('message', function message(msgJSON) {
          let msgObj = {};
          let pObj;
          let hObj;
          try {
            msgObj = JSON.parse(msgJSON);
            if (msgObj.payload.command !== "ping" && msgObj.payload.command !== "pong") {
              logObj('Received from other server', msgObj, "A");
            } else if (printPings == true) {
              logObj('Received from other server', msgObj, "A");
            }
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
                log(`Received unknown from other server: ${dim}${msgJSON}${reset}`, "W");
            }
          } catch (e) {
            try {
              msgObj = JSON.parse(msgJSON);
              if (msgObj.payload.command !== "ping" && msgObj.payload.command !== "pong") {
                logObj('Received from other server', msgObj, "A");
              } else if (printPings == true) {
                logObj('Received from other server', msgObj, "A");
              }
              if (typeof msgObj.type == "undefined") {
                let stack = e.stack.toString().split(/\r\n|\n/);
                stack = JSON.stringify(stack, null, 4);
                log(`Server error, stack trace: ${stack}`, "E");
              } else {
                log("A device is using old tally format, upgrade it to v4.0 or above", "E");
              }
            } catch (e2) {
              log("Invalid JSON from other server- "+e, "E");
              log('Received from other server: '+msgJSON, "A");
            }
          }
        });

        outbound.on('close', function close() {
          thisServer.connected = false;
          thisServer.socket = null;
          thisServer.attempts++;
          if (!inError) {
            log(`${r}${server}${reset} Outbound connection closed`, "W");
            sendServerListToClients();
            let payload = {};
            payload.command = "server";
            payload.servers = state.servers.getDetails(server);
            sendAdmins(makePacket(payload));
          }
        });

        outbound.on('error', function error() {
          inError = true;
          log(`Could not connect to server: ${r}${server}${reset}`, "E");
        });
      } else if (!thisServer.connected && thisServer.active) {
        thisServer.active = false;
        log(`Server not responding, changing status to dead: ${r}${server}${reset}`, "E");
      }
    }
  }
}

function sendServerListToClients() {
  log("Sending updated server list to clients", "D");
  let payload = {};
  payload.command = "server";
  payload.servers = state.servers.getDetails("ALL");

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
  state.servers.getDetails("ALL");
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

function makeHeader(intType = type, intVersion = version) {
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
  log("Starting HTTPS server");
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

    let options = {
      cert: sslCert,
      key: sslKey
    };

    const app = express();
    const serverHTTPS = createServer(options, app);

    serverHTTPS.on('upgrade', (request, socket, head) => {
      log("Upgrade request received", "D");
      coreServer.handleUpgrade(request, socket, head, socket => {
        coreServer.emit('connection', socket, request);
      });
    });

    app.set('views', __dirname + '/views');
    app.set('view engine', 'ejs');
    app.use(express.static('public'));

    app.get('/', function(request, response) {
      log("Serving tally page", "A");
      response.header('Content-type', 'text/html');
      let camera;
      if (request.query.camera) {
        camera = request.query.camera;
      } else {
        camera = 1;
      }
      response.render('tally', {
        host: host,
        camera: camera,
        serverName: serverName
      });
    });

    app.get('/config', function(request, response) {
      log("Serving config page", "A");
      response.header('Content-type', 'text/html');
      response.render('config', {
        host: host,
        serverName: serverName
      });
    });
    app.get('/mixer', function(request, response) {
      log("Serving config page", "A");
      response.header('Content-type', 'text/html');
      response.render('mixer', {
        host: host,
        serverName: serverName
      });
    });
    app.get('/servers', function(request, response) {
      log("Serving config page", "A");
      response.header('Content-type', 'text/html');
      response.render('servers', {
        host: host,
        serverName: serverName,
        version: version
      });
    });

    app.get('/components/config', function(request, response) {
      log("Sending config component", "A");
      response.header('Content-type', 'text/html');
      response.render('components/config', {get: request.query});
    });
    app.get('/components/server', function(request, response) {
      log("Sending server component", "A");
      let details = state.servers.getDetails(request.query.address);
      details.address = request.query.address;
      response.header('Content-type', 'text/html');
      response.render('components/server', {details: details});
    });

    return serverHTTPS;
  } else {
    return null;
  }
}

function loadConfig(fromFile = true) {
  if (fromFile) {
    try {
      config = JSON.parse(fs.readFileSync(configLocation+'/config.conf', { encoding: 'utf8' }));
    } catch (e) {
      createConfig(true);
    }
  } else {
    createConfig(false);
  }

  if (typeof config.createLogFile !== "undefined") {
    createLogFile = config.createLogFile;
  } else {
    createLogFile = true;
  }

  printHeader();

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

  if (typeof config.printPings !== "undefined") {
    printPings = config.printPings;
  } else {
    printPings = false;
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

  debugLineNum = (debugLineNum === "false" || debugLineNum === false) ? false : true;
  createLogFile = (createLogFile === "false" || createLogFile === false) ? false : true;
  ownHTTPserver = (ownHTTPserver === "false" || ownHTTPserver === false) ? false : true;
  port = parseInt(port);

  log(`WebTally server running on port: ${y}${port}${w}`);
  switch (loggingLevel) {
    case "A":
      log(`Logging set to ${y}All${w}`);
      break;
    case "D":
      log(`Logging set to ${y}Debug${w}`);
      break;
    case "W":
      log(`Logging set to ${y}Warning${w} & ${y}Error${w}`);
      break;
    case "E":
      log(`Logging set to ${y}Error${w} only`);
      break;
    default:
  }

  log("Show line number in logs set to: "+debugLineNum);

  let today = new Date();
  let dd = String(today.getDate()).padStart(2, '0');
  let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
  let yyyy = today.getFullYear();

  let fileName = `${configLocation}/tallyServer-[${yyyy}-${mm}-${dd}].log`;
  log(`Logging to file: ${y}${fileName}${w}`);

  if (typeof config.dataBase !== "undefined" && config.dataBase !== false) {
    log(`Setting up ${y}with${w} database connection`, "C");
    //Database connection code here
  } else {
    log(`Running ${y}without${w} database connection`, "C");
  }
}

function createConfig(error = true) {
  if (error) {
    log("Config could not be loaded, missing file or invalid JSON?", "E");
  }
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
  let certPath;
  let keyPath;
  if (ownHTTPserver == true || ownHTTPserver == "true") {
    certPath = reader.question("Path to SSL certificate (normally .pem) eg. /keys/cert.pem: ");
    keyPath = reader.question("Path to SSL key (normally .key) eg. /keys/cert.key: ");
  }

  port = parseInt(port);
  debugLineNum = (debugLineNum === "false" || debugLineNum === false) ? false : true;
  createLogFile = (createLogFile === "false" || createLogFile === false) ? false : true;
  ownHTTPserver = (ownHTTPserver === "false" || ownHTTPserver === false) ? false : true;

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
  if (ownHTTPserver == true || ownHTTPserver == "true") {
    config.certPath = certPath;
    config.keyPath = keyPath;
  }
  try {
    fs.writeFileSync(configLocation+'/config.conf', JSON.stringify(config, null, 4));
    log("Config saved to file");
  } catch (error) {
    log("Could not write config file, running with entered details anyway", "E");
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

  logFile("                                                                  ", true);
  logFile(" __          __    _   _______      _  _                   _  _   ", true);
  logFile(" \\ \\        / /   | | |__   __|    | || |                 | || |  ", true);
  logFile("  \\ \\  /\\  / /___ | |__  | |  __ _ | || | _   _    __   __| || |_ ", true);
  logFile("   \\ \\/  \\/ // _ \\| '_ \\ | | / _` || || || | | |   \\ \\ / /|__   _|", true);
  logFile("    \\  /\\  /|  __/| |_) || || (_| || || || |_| |    \\ V /    | |  ", true);
  logFile("     \\/  \\/  \\___||_.__/ |_| \\__,_||_||_| \\__, |     \\_/     |_|  ", true);
  logFile("                                           __/ |                  ", true);
  logFile("                                          |___/                   ", true);
  logFile("                                                                  ", true);
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

function log(message, level, lineNumInp) {
  let e = new Error();
  let stack = e.stack.toString().split(/\r\n|\n/);
  let lineNum = '('+stack[2].substr(stack[2].indexOf("server.js:")+10);
  if (typeof lineNumInp !== "undefined") {
    lineNum = lineNumInp;
  }
  if (lineNum[lineNum.length - 1] !== ")") {
    lineNum += ")";
  }
  let timeNow = new Date();
  let hours = String(timeNow.getHours()).padStart(2, "0");
  let minutes = String(timeNow.getMinutes()).padStart(2, "0");
  let seconds = String(timeNow.getSeconds()).padStart(2, "0");
  let millis = String(timeNow.getMilliseconds()).padStart(3, "0");

  let timeString = `${hours}:${minutes}:${seconds}.${millis}`;

  if (typeof message === "undefined") {
    log(`Log message from line ${p}${lineNum}${reset} is not defined`, "E");
    return;
  } else if (typeof message !== "string") {
    log(`Log message from line ${p}${lineNum}${reset} is not a string so attemping to stringify`, "A");
    try {
      message = JSON.stringify(message, null, 4);
    } catch (e) {
      log(`Log message from line ${p}${lineNum}${reset} could not be converted to string`, "E");
    }
  }

  if (debugLineNum == false || debugLineNum == "false") {
    lineNum = "";
  }

  message = message.replace(/true/g, g+"true"+w);
  message = message.replace(/false/g, r+"false"+w);
  message = message.replace(/null/g, y+"null"+w);
  message = message.replace(/undefined/g, y+"undefined"+w);

  const regexp = / \((.*?):(.[0-9]*):(.[0-9]*)\)"/g;
  let matches = message.matchAll(regexp);
  for (let match of matches) {
    message = message.replace(match[0],`" [${y}${match[1]}${reset}] ${p}(${match[2]}:${match[3]})${reset}`);
  }

  let msg;
  switch (level) {
    case "A":
      if (loggingLevel == "A") { //White
        logSend(`[${timeString}]${w}  INFO: ${dim}${message}${bright} ${p}${lineNum}${reset}`);
      }
      break;
    case "D":
      if (loggingLevel == "A" || loggingLevel == "D") { //Cyan
        logSend(`[${timeString}]${c} DEBUG: ${w}${message} ${p}${lineNum}${reset}`);
      }
      break;
    case "W":
      if (loggingLevel != "E") { //Yellow
        logSend(`[${timeString}]${y}  WARN: ${w}${message} ${p}${lineNum}${reset}`);
      }
      break;
    case "E": //Red
      logSend(`[${timeString}]${r} ERROR: ${w}${message} ${p}${lineNum}${reset}`);
      break;
    case "S": //Blue
      logSend(`[${timeString}]${b} NETWK: ${w}${message} ${p}${lineNum}${reset}`);
      break;
    default: //Green
      logSend(`[${timeString}]${g}  CORE: ${w}${message} ${p}${lineNum}${reset}`);
  }
}

function logObj(message, obj, level) {
  let e = new Error();
  let stack = e.stack.toString().split(/\r\n|\n/);
  let lineNum = '('+stack[2].substr(stack[2].indexOf("server.js:")+10);

  let combined = `${message}: ${JSON.stringify(obj, null, 4)}`;
  log(combined, level, lineNum);
}

function logSend(message) {
  logFile(message);
  logSocket(message);
  console.log(message);
}

function logSocket(message) {
  if (typeof coreServer !== "undefined") {
    let packet = makePacket({"command":"log","data":{"log":message}});
    sendAdmins(packet);
  }
}

function logFile(msg, sync = false) {
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
    let data = msg.replaceAll(r, "").replaceAll(g, "").replaceAll(y, "").replaceAll(b, "").replaceAll(p, "").replaceAll(c, "").replaceAll(w, "").replaceAll(reset, "").replaceAll(dim, "").replaceAll(bright, "")+"\n";

    if (sync) {
      try {
        fs.appendFileSync(fileName, data);
      } catch (error) {
        createLogFile = false;
        log("Could not write to log file, permissions?", "E");
      }
    } else {
      fs.appendFile(fileName, data, err => {
        if (err) {
          createLogFile = false;
          log("Could not write to log file, permissions?", "E");
        }
      });
    }
  }
}
