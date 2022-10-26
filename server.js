#!/usr/bin/env node
/*jshint esversion: 6 */
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';
import https from 'https';
import http from 'http';
import { createRequire } from "module";
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import express from 'express';
import reader from 'readline-sync';
import {log, logObj, logs, logEvent} from 'xeue-logs';

const require = createRequire(import.meta.url);
const {version} = require("./package.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
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
let dataBase;
let certPath;
let keyPath;
let serverName = "WebTally Server v4";
let printPings = false;
let useSSL = false;

let config;
const configLog = ['H', 'CONFIG', logs.c];

loadArgs();

await loadConfig();
const state = await setUpStates();

const serverWS = new WebSocketServer({ noServer: true });
log("Started Websocket server");
const serverHTTP = startHTTP(useSSL);
serverHTTP.listen(port);
serverHTTP.on('upgrade', (request, socket, head) => {
  log("Upgrade request received", "D");
  serverWS.handleUpgrade(request, socket, head, socket => {
    serverWS.emit('connection', socket, request);
  });
});

// Main websocket server functionality
serverWS.on('connection', async socket => {
  log("New connection established, sending it other severs list", "D");
  // Sending server list
  sendData(socket, {
    command: "server",
    servers: state.servers.getStatus("ALL")
  });
  socket.pingStatus = "alive";
  socket.on('message', async (msgJSON)=>{
    await onWSMessage(msgJSON, socket)
  });
  socket.on('close', ()=>{
    onWSClose(socket)
  });
});

serverWS.on('error', () => {
  log("Server failed to start or crashed, please check the port is not in use", "E");
  process.exit(1);
});

setInterval(() => {
  doPing();
  connectToOtherServers();
}, 5000);

// 1 Minute ping loop
setInterval(() => {
  connectToOtherServers(true);
}, 60000);

function doPing() {
  if (printPings) log("Doing ping", "A");
  const counts = {
    alive: 0,
    dead: 0
  };
  serverWS.clients.forEach(client => {
    if (client.readyState !== WebSocket.OPEN) return
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
  });
  if (!printPings) return
  log("Clients alive: "+counts.alive, "A");
  log("Clients dead: "+counts.dead, "A");
}

async function setUpStates() {
  let state = {};

  let dir = `${configLocation}/states`;
  state.fileNameTally = dir+"/tallyState.json";
  state.fileNameServers = dir+"/serversState.json";
  state.fileNameClients = dir+"/clientsState.json";
  state.fileNameMixers = dir+"/mixerState.json";
  state.fileNameBuss = dir+"/busState.json";
  state.fileNameProperties = dir+"/server.properties";

  // State functions defined here
  stateTally(state);
  stateServers(state);
  stateClients(state);
  stateMixer(state);
  stateBusses(state);

  await folderExists(dir, true);
  await Promise.all([
    readFile(state.fileNameTally, {"default":{"main":{}}}).then((data)=>{
      if (typeof data !== "undefined") {
        state.tally.data = JSON.parse(data);
      } else {
        state.tally.data = {"default":{"main":{}}};
      }
    }),
    readFile(state.fileNameServers).then((data)=>{
      if (typeof data === "undefined") return;
      let serverData = state.servers.data;
      serverData = JSON.parse(data);
      for (const server in serverData) {
        if (serverData.hasOwnProperty(server)) {
          serverData[server].socket = null;
          serverData[server].connected = false;
        }
      }
    }),
    readFile(state.fileNameClients).then((data)=>{
      if (typeof data === "undefined") return;
      state.clients.data = JSON.parse(data);
    }),
    readFile(state.fileNameMixers).then((data)=>{
      if (typeof data === "undefined") return;
      state.mixer.data = JSON.parse(data);
    }),
    readFile(state.fileNameBuss).then((data)=>{
      if (typeof data === "undefined") return;
      state.bus.data = JSON.parse(data);
    }),
    readFile(state.fileNameProperties, {"myID": myID}).then((data)=>{
      if (typeof data === "undefined") return;
      const properties = JSON.parse(data);
      myID = properties.myID;
      log(`Server ID is: ${logs.y}${myID}${logs.w}`, configLog);
    })
  ]);
  return state;
}

function stateTally(state) {
  state["tally"] = {
    "data":{},
    update(busses, source = "default") {
      const savedBusses = typeof this.data[source] == "undefined" ? {} : this.data[source];

      for (const busName in busses) {
        if (!busses.hasOwnProperty(busName)) {
          const bus = busses[busName];
          for (const camNum in bus) {
            if (!bus.hasOwnProperty(camNum)) {
              const cam = bus[camNum];
              const savedBus = typeof savedBusses[busName] == "undefined" ? this.newBus(busName, source) : savedBusses[busName];
    
              if (typeof savedBus[camNum] == "undefined") {
                savedBus[camNum] = {
                  "prog":false,
                  "prev":false
                };
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

      if (!dataBase) {
        fs.writeFile(state.fileNameTally, JSON.stringify(this.data), error => {
          if (error) logObj("Could not save tally state to file", error, "W");
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
      return this.data[source][busName];
    },
    updateClients(socket = null) {
      setTimeout(function() {
        for (const source in state.tally.data) {
          if (state.tally.data.hasOwnProperty(source)) {
            const packet = makePacket({
              'busses': state.tally.data[source],
              'command': "tally",
              'source': source
            });
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
        for (const source in this.data) {
          if (this.data.hasOwnProperty(source)) {
            const packet = makePacket({
              'busses': this.data[source],
              'command': "tally",
              'source': source
            });
            socket.send(JSON.stringify(packet));
          }
        }
      },100);
    },
    clean() {
      log("Clearing tally states");
      this.data = {};
      fs.unlink(state.fileNameTally, (err) => {
        if (err) {
          log("Could not remove tally states file, it either didn't exists or permissions?", "W");
        } else {
          log("Cleared tally states");
        }
      });
    }
  };
}
function stateServers(state) {
  state["servers"] = {
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
        if (serverWS) {
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
        log(`Updating server details for: ${address}`, "D");
        this.data[address].version = header.version;
        this.data[address].ID = header.fromID;
        if (typeof name !== "undefined") {
          this.data[address].Name = name;
        } else {
          this.data[address].Name = `Webtally v${header.version} server`;
        }
        sendAdmins(makePacket({
          'command': "server",
          'servers': this.getDetails(address, true)
        }));
        sendServerListToClients();
      } else {
        log("Address not registered, adding: "+address, "D");
        this.add(address, header, name);
      }

      this.save();
    },
    remove(url) {
      if (this.data.hasOwnProperty(url)) {
        log(`Removing address and closing outbound connection to: ${logs.y}${url}${logs.reset}`, "D");
        try {
          this.data[url].socket.close();
        } catch (e) {
          log("Server connection already closed","W");
        }
        delete this.data[url];
      }

      serverWS.clients.forEach(function each(client) {
        if (client.address == url && client.readyState === WebSocket.OPEN) {
          client.terminate();
        }
      });
      sendAdmins(makePacket({
        'command': 'server',
        'servers': this.getDetails(url, true)
      }));
      this.save();
    },
    getURLs(print = false) {
      const serverDataList = [];
      const serverData = this.data;
      for (const server in serverData) {
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
      const serverDataTrimmed = {};
      const serverData = this.data;
      for (const server in serverData) {
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
      const details = {};
      if (server == "ALL") {
        for (const serverName in this.data) {
          if (!this.data.hasOwnProperty(serverName)) {
            const server = this.data[serverName];
            details[data] = {
              'socket': "SOCKET OBJECT",
              'active': server.active,
              'connected': server.connected,
              'attempts': server.attempts,
              'version': server.version,
              'ID': server.ID,
              'Name': server.Name
            };
          };
        }

        for (const detail in details) {
          if (!details.hasOwnProperty(detail)) {
            if (details[detail].connected) {
              details[detail].socket = "SOCKET OBJECT";
            } else {
              details[detail].socket = null;
            }
          };
        }
      } else if (server == host) {
        details[server] = this.getThisServer();
      } else {
        if (typeof this.data[server] === "undefined") {
          const targetServer = this.data[server];
          details[server] = {
            'socket': "SOCKET OBJECT",
            'active': targetServer.active,
            'connected': targetServer.connected,
            'attempts': targetServer.attempts,
            'version': targetServer.version,
            'ID': targetServer.ID,
            'Name': targetServer.Name
          };
        };
      }
      if (print === true) {
        logObj("Server details", details, "A");
      } else if (print == "S") {
        logObj("Server details", details, "S");
      }
      return details;
    },
    getThisServer() {
      return {
        "socket": "SOCKET OBJECT",
        "active":true,
        "connected":true,
        "attempts":0,
        "version":version,
        "ID":myID,
        "Name":serverName
      };
    },
    save() {
      if (dataBase === false) {
        const data = JSON.stringify(this.getDetails("ALL", true));
        fs.writeFile(state.fileNameServers, data, err => {
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
      const servers = this.getURLs();
      for (let i = 0; i < servers.length; i++) {
        this.remove(servers[i]);
      }
      this.data = {};
      fs.unlink(state.fileNameServers, (err) => {
        if (err) {
          log("Could not remove server states file, it either didn't exists or permissions?", "W");
        } else {
          log("Cleared server states");
        }
      });
    }
  };
}
function stateClients(state) {
  state["clients"] = {
    "data":{},
    add(msgObj, socket) {
      const header = msgObj.header;
      const payload = msgObj.payload;
      if (header.type == "Server") return;
      if (header.fromID == socket.ID) {
        this.data[socket.ID] = {
          'camera': socket.camera,
          'connected': socket.connected,
          'prodID': socket.prodID,
          'type': socket.type,
          'version': socket.version,
          'local': true,
          'pingStatus': socket.pingStatus,
          'socket': socket
        };
      } else {
        this.data[header.fromID] = {
          'camera': payload.camera,
          'connected': header.active,
          'prodID': header.prodID,
          'type': header.type,
          'version': header.version,
          'local': false
        };
      }
      this.save();
    },
    addAll(clients) {
      const clientsData = this.data;
      for (const clientName in clients) {
        if (clients.hasOwnProperty(clientName) && !clientsData.hasOwnProperty(clientName)) {
          const client = clients[clientName];
          clientsData[clientName] = {
            'camera': client.camera,
            'connected': client.active,
            'type': client.type,
            'version': client.version,
            'local': false
          };
        }
      }
    },
    update(msgObj, socket) {
      const header = msgObj.header;
      const payload = msgObj.payload;
      const clientsData = this.data;
      if (header.type != "Server") {
        if (typeof clientsData[header.fromID] == "undefined") {
          this.add(msgObj, socket);
        } else if (header.fromID == socket.ID) {
          clientsData[socket.ID] = {
            'camera': socket.camera,
            'connected': socket.connected,
            'type': socket.type,
            'version': socket.version,
            'local': true,
            'pingStatus': socket.pingStatus,
            'socket': socket
          };
        } else {
          clientsData[header.fromID] = {
            'camera': payload.camera,
            'connected': header.active,
            'type': header.type,
            'version': header.version,
            'local': false
          };
        }
      }
    },
    remove(socket) {
      const clientsData = this.data;
      if (typeof socket == "string") {
        if (typeof clientsData[socket] !== "undefined" && clientsData[socket].local == true) {
          clientsData[socket].socket.terminate();
          delete clientsData[socket];
        } else {
          delete clientsData[socket];
        }
      } else {
        if ( socket.type == "Server"
          || socket.type == "Config"
          || socket.type == "Admin"
        ) return;
        if (typeof clientsData[socket.ID] !== "undefined" && clientsData[socket.ID].local == true) {
          delete clientsData[socket.ID];
          socket.terminate();
        } else {
          delete clientsData[socket.ID];
        }
      }
      this.save();
    },
    disconnect(socket) {
      const clientsData = this.data;
      if (typeof socket == "string") {
        if (typeof clientsData[socket] !== "undefined" && clientsData[socket].local == true) {
          clientsData[socket].socket.terminate();
        } else {
          delete clientsData[socket];
        }
        clientsData[socket].socket = false;
        clientsData[socket].connected = false;
        clientsData[socket].pingStatus = "dead";
      } else {
        if ( socket.type == "Server"
          || socket.type == "Config"
          || socket.type == "Admin"
        ) return;
        if (typeof clientsData[socket.ID] !== "undefined" && clientsData[socket.ID].local == true) {
          socket.terminate();
        }
        clientsData[socket.ID].socket = false;
        clientsData[socket.ID].connected = false;
        clientsData[socket.ID].pingStatus = "dead";
      }
      this.save();
    },
    getDetails(socket = "ALL", print = false) {
      const clientsData = this.data;
      let details = {};
      const clientBySocket = clientsData[socket.ID];
      if (socket == "ALL") {
        for (const clientID in clientsData) {
          if (!clientsData.hasOwnProperty(clientID)) return;
          const client = clientsData[clientID];
          details[clientID] = {
            'camera': client.camera,
            'name': client.name,
            'connected': client.connected,
            'prodID': client.prodID,
            'type': client.type,
            'version': client.version,
            'local': client.local
          };
          if (client.local == true) {
            details[clientID].pingStatus = client.pingStatus;
            details[clientID].socket = "SOCKET OBJECT";
          }
        }
        if (print === true) {
          logObj("Clients details", details, "A");
        } else if (print == "S") {
          logObj("Clients details", details, "S");
        }
      } else if (typeof clientBySocket !== "undefined") {
        details[socket.ID] = {
          'camera': clientBySocket.camera,
          'name': clientBySocket.name,
          'connected': clientBySocket.connected,
          'prodID': clientBySocket.prodID,
          'type': clientBySocket.type,
          'version': clientBySocket.version
        }
        if (clientBySocket.local == true) {
          details[socket.ID].pingStatus = clientBySocket.pingStatus;
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
        const data = JSON.stringify(this.getDetails("ALL"));
        fs.writeFile(state.fileNameClients, data, err => {
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
      fs.unlink(state.fileNameClients, (err) => {
        if (err) {
          log("Could not remove client states file, it either didn't exists or permissions?", "W");
        } else {
          log("Cleared clients states");
        }
      });
    }
  };
}
function stateMixer(state) {
  state["mixer"] = {
    "data":{},
    add(msgObj, socket) {
      const header = msgObj.header;
      const payload = msgObj.payload;
      const mixersData = this.data;
      if (header.type == "Server") return;
      if (header.fromID == socket.ID) {
        mixersData[socket.ID] = {
          'camera': socket.camera,
          'connected': socket.connected,
          'type': socket.type,
          'version': socket.version,
          'local': true,
          'pingStatus': socket.pingStatus,
          'socket': socket
        };
      } else {
        mixersData[header.fromID] = {
          'camera': payload.camera,
          'connected': header.active,
          'type': header.type,
          'version': header.version,
          'local': false
        };
      }
      this.save();
    },
    addAll(mixers) {
      const mixersData = this.data;
      for (const mixerName in mixers) {
        if (mixers.hasOwnProperty(mixerName) && !mixersData.hasOwnProperty(mixerName)) {
          const mixer = mixers[mixerName];
          mixersData[mixerName] = {
            'camera': mixer.camera,
            'connected': mixer.active,
            'type': mixer.type,
            'version': mixer.version,
            'local': false
          };
        }
      }
    },
    update(msgObj, socket) {
      const header = msgObj.header;
      const payload = msgObj.payload;
      const mixersData = this.data;
      if (header.type == "Server") return;
      if (typeof mixersData[header.fromID] == "undefined") {
        this.add(msgObj, socket);
      } else if (header.fromID == socket.ID) {
        mixersData[socket.ID] = {
          'camera': socket.camera,
          'connected': socket.connected,
          'type': socket.type,
          'version': socket.version,
          'local': true,
          'pingStatus': socket.pingStatus,
          'socket': socket
        };
      } else {
        mixersData[header.fromID] = {
          'camera': payload.camera,
          'connected': header.active,
          'type': header.type,
          'version': header.version,
          'local': false
        };
      }
    },
    remove(socket) {
      const mixersData = this.data;
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
      const mixersData = this.data;
      let details = {};
      const mixerFromSocket = mixersData[socket.ID];
      if (socket == "ALL") {
        for (const mixerName in mixersData) {
          const mixer = mixersData[mixerName];
          if (mixersData.hasOwnProperty(mixerName)) {
            details[mixerName] = {
              'camera': mixer.camera,
              'connected': mixer.connected,
              'type': mixer.type,
              'version': mixer.version,
              'local': mixer.local
            };
            if (mixer.local == true) {
              details[mixerName].pingStatus = mixer.pingStatus;
              details[mixerName].socket = "SOCKET OBJECT";
            }
          }
        }
        if (print === true) {
          log("mixers details", details, "A");
        } else if (print == "S") {
          logObj("mixers details", details, "S");
        }
      } else if (typeof mixerFromSocket !== "undefined") {
        details[socket.ID] = {
          'camera': mixerFromSocket.camera,
          'connected': mixerFromSocket.connected,
          'type': mixerFromSocket.type,
          'version': mixerFromSocket.version
        }
        if (mixerFromSocket.local == true) {
          details[socket.ID].pingStatus = mixerFromSocket.pingStatus;
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
        fs.writeFile(state.fileNameMixers, data, err => {
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
      fs.unlink(state.fileNameMixers, (err) => {
        if (err) {
          log("Could not remove mixer states file, it either didn't exists or permissions?", "W");
        } else {
          log("Cleared mixers states");
        }
      });
    }
  };
}
function stateBusses(state) {
  state["busses"] = {
    "data":{},
    getProdID(prodName) {
      for (const ID in this.data) {
        if (this.data.hasOwnProperty(ID)) {
          if (this.data[ID].name == prodName) {
            return ID;
          }
        }
      }
      return "NAN";
    },
    getProdName(ID) {
      return this.data[ID].name;
    },
    addProduction(prodName = "default") {
      const ID = getProdID(prodName);
      if (ID == "NAN") {
        this.data[ID] = {
          "name":prodName,
          "busses":{}
        };
      } else {
        this.data[ID].name = prodName;
      }
      return ID;
    },
    addProductionID(prodID = 1, prodName = "default") {
      if (typeof this.data[prodID] == "undefined") {
        this.data[prodID] = {
          "name":prodName,
          "busses":{}
        }
        return prodName;
      } else {
        return this.data[prodID].name;
      }
    },
    setProduction(obj, prodID = 1) {
      this.data[prodID] = obj;
    },

    getBusID(prodID, busName) {
      addProductionID(prodID);
      const bus = this.data[prodID].busses;
      for (const ID in bus) {
        if (bus.hasOwnProperty(ID)) {
          if (bus[ID].name == busName) {
            return ID;
          }
        }
      }
      return "NAN";
    },
    getBusName(prodID, busID) {
      if (typeof this.data[prodID].busses[busID] == "undefined") {
          this.data[prodID].busses[busID] = {
            "name":"program",
            "inputs":2,
            "names":{}
          }
      }
      return this.data[prodID].busses[busID].name;
    },
    addBus(busName = "Program", prodID = 1) {
      addProductionID(prodID);
      const ID = getBusID(prodName);
      if (ID == "NAN") {
        this.data[prodID].busses[ID] = {
          "name":busName,
          "inputs":1,
          "names":{}
        };
      } else {
        this.data[prodID].busses[ID].name = busName;
      }
      return ID;
    },
    setBus(obj, busName = "Program", prodID = 1) {
      const busID = addBus(busName, prodID);
      this.data[prodID].busses[busID].names = obj;
    },

    setName(name, input, busID = 1, prodID = 1) {
      const busName = getBusName(busID);
      addBus(busName, prodID);
      this.data[prodID].busses[busID].names[input] = name;
    },

    getName(input, busID = 1, prodID = 1) {
      return this.data[prodID].busses[busID].names[input];
    },
    getBus(busID, prodID = 1) {
      return this.data[prodID].busses[busID];
    },
    getProduction(prodID = 1) {
      return this.data[prodID];
    },
    getAll() {
      return this.data;
    },

    save() {
      if (dataBase === false) {
        const data = JSON.stringify(this.getAll());
        fs.writeFile(state.fileNameBuss, data, err => {
          if (err) {
            log("Could not save buss state to file, permissions?", "W");
          }
        });
      } else {
        log("Not implemented yet - database connection", "W");
      }
    },
    clean() {
      log("Clearing buss states");
      this.data = {};
      fs.unlink(state.fileNameBuss, (err) => {
        if (err) {
          log("Could not remove bus states file, it either didn't exists or permissions?", "W");
        } else {
          log("Cleared buss states");
        }
      });
    }
  };
}

/* Core functions & Message handeling */

async function onWSMessage(msgJSON, socket) {
  let msgObj = {};
  try {
    msgObj = JSON.parse(msgJSON);
    if (msgObj.payload.command !== "ping" && msgObj.payload.command !== "pong") {
      logObj('Received', msgObj, "A");
    } else if (printPings == true) {
      logObj('Received', msgObj, "A");
    }
    const payload = msgObj.payload;
    const header = msgObj.header;
    if (typeof payload.source == "undefined") {
      payload.source = "default";
    }
    switch (payload.command) {
      case "meta":
        log('Received: '+msgJSON, "D");
        socket.send("Received meta");
        break;
      case "register":
        coreDoRegister(socket, msgObj);
        break;
      case "disconnect":
        log(`${logs.r}${payload.data.ID}${logs.reset} Connection closed`, "D");
        state.clients.disconnect(payload.data.ID);
        sendConfigs(msgObj, socket);
        sendServers(msgObj);
        break;
      case "tally":
        log("Recieved tally data", "D");
        sendServers(msgObj);
        sendClients(msgObj, socket);
        state.tally.update(payload.busses, payload.source);
        break;
      case "config":
        log("Config data is being sent to clients", "D");
        if (socket.ID == header.fromID) {
          sendSelf(msgObj, socket);
        }
        sendAll(msgObj, socket);
        state.tally.updateClients();
        break;
      case "command":
        await coreDoCommand(socket, msgObj);
        break;
      case "pong":
        socket.pingStatus = "alive";
        break;
      case "ping":
        socket.pingStatus = "alive";
        sendData(socket, {
          'command': 'pong'
        });
        break;
      case "server":
        log("Received new servers list from other server", "D");
        let servers = payload.servers;
        for (let server in servers) {
          state.servers.add(server);
        }
        break;
      case "clients":
        state.clients.addAll(payload.clients);
        log("Recieved clients list from other server", "D");
        break;
      case "error":
        log(`Device ${header.fromID} has entered an error state`, "E");
        log(`Message: ${payload.error}`, "E");
        logObj(`Device ${header.fromID} connection details`, state.clients.getDetails(socket), "E");
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
        logObj(`Server error`, e, "E");
      } else {
        log("A device is using old tally format, upgrade it to v4.0 or above", "E");
      }
    } catch (e2) {
      logObj("Invalid JSON", e, "E");
      log('Received: '+msgJSON, "A");
    }
  }
}

function onWSClose(socket) {
  try {
    let oldId = JSON.parse(JSON.stringify(socket.ID));
    log(`${logs.r}${oldId}${logs.reset} Connection closed`, "D");
    socket.connected = false;
    if (socket.type == "Server") {
      log(`${logs.r}${socket.address}${logs.reset} Inbound connection closed`, "W");
    } else {
      state.clients.disconnect(oldId);
    }
    let packet = makePacket({"command":"disconnect","data":{"ID":oldId}});
    sendServers(packet);
    sendConfigs(packet, socket);
  } catch (e) {
    log("Could not end connection cleanly","E");
  }
}

function coreDoRegister(socket, msgObj) {
  const header = msgObj.header;
  const payload = msgObj.payload;
  if (typeof socket.type == "undefined") {
    socket.type = header.type;
  }
  if (typeof socket.ID == "undefined") {
    socket.ID = header.fromID;
  }
  if (typeof socket.version == "undefined") {
    socket.version = header.version;
  }
  if (typeof socket.prodID == "undefined") {
    socket.prodID = header.prodID;
  }
  if (header.version !== version) {
    if (header.version.substr(0, header.version.indexOf('.')) != version.substr(0, version.indexOf('.'))) {
      log("Connected client has different major version, it will not work with this server!", "E");
    } else {
      log("Connected client has differnet version, support not guaranteed", "W");
    }
  }
  switch (header.type) {
    case "Config":
      log(`${logs.g}${header.fromID}${logs.reset} Registered as new config controller`, "D");
      sendData(socket, {"command":"clients","clients":state.clients.getDetails()});
      socket.connected = true;
      state.clients.add(msgObj, socket);
      break;
    case "Server":
      const {address, name} = payload;
      socket.address = address;
      socket.name = name;
      log(`${logs.g}${header.fromID}${logs.reset} Registered as new server`, "D");
      log(`${logs.g}${address}${logs.reset} Registered as new inbound server connection`, "S");
      state.servers.add(address);
      state.servers.update(address, header, name);
      break;
    case "Admin":
      log(`${logs.g}${header.fromID}${logs.reset} Registered as new admin controller`, "D");
      const servers = state.servers.getDetails("ALL");
      servers[host] = state.servers.getThisServer();
      socket.connected = true;
      state.clients.add(msgObj, socket);
      sendAdmins(makePacket({
        'command': "server",
        'servers': servers
      }));
      break;
    case "Mixer":
      log(`${logs.g}${header.fromID}${logs.reset} Registered as new vision mixer/GPI controler`, "D");
      socket.connected = true;
      state.mixer.add(msgObj, socket);
      sendConfigs(msgObj, socket);
      sendServers(msgObj);
      break;
    default:
      log(`${logs.g}${header.fromID}${logs.reset} Registered as new client`, "D");
      socket.connected = true;
      if (typeof payload.data !== "undefined") {
        if (typeof payload.data.camera !== "undefined") {
          socket.camera = payload.data.camera;
        }
      }
      state.clients.add(msgObj, socket);
      sendConfigs(msgObj, socket);
      sendServers(msgObj);
      state.tally.updateClients();
  }
}

async function coreDoCommand(socket, msgObj) {
  let payload = msgObj.payload;
  log("A command is being sent to clients", "D");
  if (payload.serial == myID) {
    log("Command for this server recieved", "D");
    switch (payload.action) {
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
        await loadConfig(false);
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

/* Outgoing links */

function connectToOtherServers(retry = false) {
  const serverData = state.servers.data;
  for (const server in serverData) {
    if (serverData.hasOwnProperty(server) && typeof serverData[server] !== 'function') {
      const thisServer = serverData[server];
      if ((!thisServer.connected && thisServer.active && thisServer.attempts < 3) || (retry && !thisServer.connected)) {
        let inError = false;
        if (retry) {
          log(`Retrying connection to dead server: ${logs.r}${server}${logs.reset}`, "W");
        }
        const outbound = new WebSocket("wss://"+server);

        thisServer.socket = outbound;

        outbound.on('open', function open() {
          sendData(outbound, {
            'command': "register",
            'address': host,
            'name': serverName
          });
          log(`${logs.g}${server}${logs.reset} Established as new outbound server connection`, "S");
          thisServer.connected = true;
          thisServer.active = true;
          thisServer.attempts = 0;
          sendAdmins(makePacket({
            'command': "server",
            'servers': state.servers.getDetails(server)
          }));
          sendData(outbound, {
            "command":"clients",
            "clients":state.clients.getDetails()
          });
          state.tally.updateServer(outbound);
        });

        outbound.on('message', function message(msgJSON) {
          let msgObj = {};
          try {
            msgObj = JSON.parse(msgJSON);
            if (msgObj.payload.command !== "ping" && msgObj.payload.command !== "pong") {
              logObj('Received from other server', msgObj, "A");
            } else if (printPings == true) {
              logObj('Received from other server', msgObj, "A");
            }
            const payload = msgObj.payload;
            const header = msgObj.header;
            switch (payload.command) {
              case "ping":
                sendData(outbound, {
                  'command': 'pong'
                });
                break;
              case "server":
                log("Received new servers list from other server", "D");
                let servers = payload.servers;
                for (let server in servers) {
                  state.servers.add(server);
                }
                break;
              case "tally":
                let returnObj = updateHeader(msgObj);
                let recipients = msgObj.header.recipients;
                serverWS.clients.forEach(function each(client) {
                  if (client !== outbound && client.readyState === WebSocket.OPEN) {
                    if (!recipients.includes(client.address)) {
                      client.send(JSON.stringify(returnObj));
                    }
                  }
                });
                break;
              default:
                log(`Received unknown from other server: ${logs.dim}${msgJSON}${logs.reset}`, "W");
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
                logObj(`Server error`, e, "E");
              } else {
                log("A device is using old tally format, upgrade it to v4.0 or above", "E");
              }
            } catch (e2) {
              logObj("Invalid JSON from other server", e, "E");
              logObj('Received from other server', msgJSON, "A");
            }
          }
        });

        outbound.on('close', function close() {
          thisServer.connected = false;
          thisServer.socket = null;
          thisServer.attempts++;
          if (!inError) {
            log(`${logs.r}${server}${logs.reset} Outbound connection closed`, "W");
            sendServerListToClients();
            sendAdmins(makePacket({
              'command': "server",
              'servers': state.servers.getDetails(server)
            }));
          }
        });

        outbound.on('error', function error() {
          inError = true;
          log(`Could not connect to server: ${logs.r}${server}${logs.reset}`, "E");
        });
      } else if (!thisServer.connected && thisServer.active) {
        thisServer.active = false;
        log(`Server not responding, changing status to dead: ${logs.r}${server}${logs.reset}`, "E");
      }
    }
  }
}

/* Sends */

function sendServerListToClients() {
  log("Sending updated server list to clients", "D");
  const servers = state.servers.getDetails("ALL");
  serverWS.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.type !== "Admin") {
      sendData(client, {
        'command': 'server',
        'servers': servers
      });
    }
  });
}

function sendServers(packet) { //Only servers
  const toBeSent = typeof packet == "object" ? packet : JSON.parse(packet);
  const recipients = toBeSent.header.recipients;
  const message = JSON.stringify(updateHeader(toBeSent));
  const serverData = state.servers.data;
  state.servers.getDetails("ALL");
  for (const server in serverData) {
    if (serverData.hasOwnProperty(server) && serverData[server].connected == true && serverData[server].socket !== null) {
      if (!recipients.includes(server)) {
        serverData[server].socket.send(message);
      }
    }
  }
}

function sendClients(packet, socket = null) { //All but servers
  const toBeSent = typeof packet == "object" ? packet : JSON.parse(packet);
  const recipients = toBeSent.header.recipients;
  const message = JSON.stringify(updateHeader(toBeSent));
  serverWS.clients.forEach(client => {
    if (client !== socket && client.readyState === WebSocket.OPEN) {
      if (!recipients.includes(client.address) && client.type != "Server") {
        client.send(message);
      }
    }
  });
}

function sendConfigs(packet, socket = null) { //Only config controllers
  const toBeSent = typeof packet == "object" ? packet : JSON.parse(packet);
  const message = JSON.stringify(updateHeader(toBeSent));
  serverWS.clients.forEach(client => {
    if (client !== socket && client.readyState === WebSocket.OPEN && client.type == "Config") {
      client.send(message);
    }
  });
}

function sendAdmins(packet, socket = null) { //Only Admin controllers
  const toBeSent = typeof packet == "object" ? packet : JSON.parse(packet);
  const message = JSON.stringify(updateHeader(toBeSent));
  serverWS.clients.forEach(client => {
    if (client !== socket && client.readyState === WebSocket.OPEN && client.type == "Admin") {
      client.send(message);
    }
  });
}

function sendAll(packet, socket) { //Send to all
  sendServers(packet);
  sendClients(packet, socket);
}

function sendSelf(packet, socket) {
  const toBeSent = typeof packet == "object" ? packet : JSON.parse(packet);
  const message = JSON.stringify(updateHeader(toBeSent));
  socket.send(message);
}

/* Websocket packet functions */

function makeHeader(intType = type, intVersion = version) {
  const timeStamp = new Date().getTime();
  return {
    'fromID': myID,
    'timestamp': timeStamp,
    'version': intVersion,
    'type': intType,
    'active': true,
    'messageID': timeStamp,
    'recipients': [
      host
    ]
  };
}

function makePacket(data) {
  const payload = typeof data == "object" ? data : JSON.parse(data);
  return {
    'header': makeHeader(),
    'payload': payload
  };
}

function updateHeader(message, relayed = true) {
  const msgObj = typeof message == "object" ? message : JSON.parse(message);
  let recipients = msgObj.header.recipients;
  if (relayed == true) {
    recipients = [...new Set(recipients.concat(state.servers.getURLs()))];
  }
  return msgObj;
}

function sendData(connection, payload) {
  connection.send(JSON.stringify({
    'header': makeHeader(),
    'payload': payload
  }));
}

/* Express */

function startHTTP(useSSL) {
  log(`Started HTTP server, using SSL: ${useSSL}`);
  const app = express();
  const protocol = useSSL ? 'wss' : 'ws';
  const ejsParams = (request) => {
    return {
      host: host,
      prodID: getProdFromQuery(request),
      serverName: serverName,
      version: version,
      protocol: protocol
    }
  }
  
  const serverOptions = {};

  if (useSSL) {
    try {
      serverOptions.cert = fs.readFileSync(certPath, { encoding: 'utf8' });
    } catch (e) {
      log("Could not load server SSL certificate", "E");
      process.exit(1);
    }
  
    try {
      serverOptions.key = fs.readFileSync(keyPath, { encoding: 'utf8' });
    } catch (e) {
      log("Could not load server SSL key", "E");
      process.exit(1);
    }
  }

  const server = useSSL ? https.createServer(serverOptions, app) : http.createServer(app);

  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.static('public'));

  app.get('/', function(request, response) {
    log("Serving tally page", "A");
    response.header('Content-type', 'text/html');
    const params = ejsParams(request);
    params.camera = request.query.camera ? request.query.camera : 1;
    response.render('tally', params);
  });

  app.get('/config', function(request, response) {
    log("Serving config page", "A");
    response.header('Content-type', 'text/html');
    response.render('config', ejsParams(request));
  });
  app.get('/productions', function(request, response) {
    log("Serving config page", "A");
    response.header('Content-type', 'text/html');
    response.render('prod', ejsParams(request));
  });
  app.get('/mixer', function(request, response) {
    log("Serving config page", "A");
    response.header('Content-type', 'text/html');
    response.render('mixer', ejsParams(request));
  });
  app.get('/servers', function(request, response) {
    log("Serving config page", "A");
    response.header('Content-type', 'text/html');
    response.render('servers', ejsParams(request));
  });

  app.get('/components/config', function(request, response) {
    log("Sending config component", "A");
    response.header('Content-type', 'text/html');
    response.render('components/config', {get: request.query});
  });
  app.get('/components/server', function(request, response) {
    log("Sending server component", "D");
    let details = state.servers.getDetails(request.query.address)[request.query.address];
    details.address = request.query.address;
    response.header('Content-type', 'text/html');
    response.render('components/server', {details: details});
  });

  return server;
}

function getProdFromQuery(request) {
  let prodID;
  if (request.query.prodID) {
    prodID = request.query.prodID;
  } else if (request.query.prodName) {
    prodID = state.busses.getProdID(request.query.prodName);
  } else {
    prodID = 1;
  }
  return prodID;
}

/* Config */

async function loadConfig(fromFile = true) {
  if (fromFile) {
    try {
      config = JSON.parse(fs.readFileSync(configLocation+'/config.conf', { encoding: 'utf8' }));
    } catch (e) {
      await createConfig(true);
    }
  } else {
    await createConfig(false);
  }

  if (typeof argLoggingLevel !== "undefined") {
    loggingLevel = argLoggingLevel;
  } else if (typeof config.loggingLevel !== "undefined") {
    loggingLevel = config.loggingLevel;
  } else {
    loggingLevel = "W"; //(A)LL,(D)EBUG,(W)ARN,(E)RROR
  }

  createLogFile = typeof config.createLogFile   !== "undefined" ? config.createLogFile  : true;
  debugLineNum  = typeof config.debugLineNum    !== "undefined" ? config.debugLineNum   : false;
  port          = typeof config.port            !== "undefined" ? config.port           : 443;
  serverName    = typeof config.serverName      !== "undefined" ? config.serverName     : "WebTally Server v4";
  printPings    = typeof config.printPings      !== "undefined" ? config.printPings     : false;
  host          = typeof config.host            !== "undefined" ? config.host           : 'localhost';
  useSSL        = typeof config.useSSL          !== "undefined" ? config.useSSL         : false;
  certPath      = typeof config.certPath        !== "undefined" ? config.certPath       : "keys/"+host+".pem";
  keyPath       = typeof config.keyPath         !== "undefined" ? config.keyPath        : "keys/"+host+".key";
  dataBase      = typeof config.dataBase        !== "undefined" ? config.dataBase       : false;

  debugLineNum  = (debugLineNum   === "false" || debugLineNum   === false) ? false : true;
  createLogFile = (createLogFile  === "false" || createLogFile  === false) ? false : true;
  useSSL        = (useSSL         === "false" || useSSL         === false) ? false : true;
  port = parseInt(port);

  if (typeof config.otherServers !== "undefined") {
    for (let i = 0; i < config.otherServers.length; i++) {
      let entry = config.otherServers[i];
      state.servers.add(entry);
    }
  }

  const logsConfig = {
    "createLogFile": createLogFile,
    "logsFileName": "TallyServer",
    "configLocation": configLocation,
    "loggingLevel": loggingLevel,
    "debugLineNum": debugLineNum
  }

  logs.setConf(logsConfig);
  logs.printHeader('WebTally   v4');

  log(`WebTally server version: ${logs.y}${version}${logs.w}`, configLog);
  log(`WebTally server running on port: ${logs.y}${port}${logs.w}`, configLog);
  switch (loggingLevel) {
    case "A":
      log(`Logging set to ${logs.y}All${logs.w}`, configLog);
      break;
    case "D":
      log(`Logging set to ${logs.y}Debug${logs.w}`, configLog);
      break;
    case "W":
      log(`Logging set to ${logs.y}Warning${logs.w} & ${logs.y}Error${logs.w}`, configLog);
      break;
    case "E":
      log(`Logging set to ${logs.y}Error${logs.w} only`, configLog);
      break;
    default:
  }

  log("Show line number in logs set to: "+debugLineNum, configLog);

  let today = new Date();
  let dd = String(today.getDate()).padStart(2, '0');
  let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
  let yyyy = today.getFullYear();

  let fileName = `${configLocation}\\logs\\tallyServer-[${yyyy}-${mm}-${dd}].log`;
  log(`Logging to file: ${logs.y}${fileName}${logs.w}`, configLog);

  if (typeof config.dataBase !== "undefined" && config.dataBase !== false) {
    log(`Setting up ${logs.y}with${logs.w} database connection`, configLog);
    //Database connection code here
  } else {
    log(`Running ${logs.y}without${logs.w} database connection`, configLog);
  }
}

async function createConfig(error = true) {
  if (error) {
    log("Config could not be loaded, missing file or invalid JSON?", "E");
  }
  log("Creating new config file");

  await folderExists(configLocation, true);

  let port = reader.question("What port shall the server use: ");
  let host = reader.question("What url/IP is the server connected to from: ");
  let serverName = reader.question("Please name this server: ");
  let loggingLevel = reader.question("What logging level would you like? (A)ll (D)ebug (W)arnings (E)rror: ");
  let debugLineNum = reader.question("Would you like to print line numbers in the logs? true/false: ");
  let createLogFile = reader.question("Would you like to write the log to a file? true/false: ");
  let otherHost = reader.question("If possible provide the url/ip of another server in the network: ");
  let useSSL = reader.question("Should this sever use an SSL certificate? true/false: ");
  let certPath;
  let keyPath;
  if (useSSL == true || useSSL == "true") {
    certPath = reader.question("Path to SSL certificate (normally .pem) eg. /keys/cert.pem: ");
    keyPath = reader.question("Path to SSL key (normally .key) eg. /keys/cert.key: ");
  }

  port = parseInt(port);
  debugLineNum  = (debugLineNum === "false"   || debugLineNum === false)  ? false : true;
  createLogFile = (createLogFile === "false"  || createLogFile === false) ? false : true;
  useSSL        = (useSSL === "false"         || useSSL === false)        ? false : true;

  config = {
    "port":port,
    "host":host,
    "serverName":serverName,
    "loggingLevel":loggingLevel,
    "debugLineNum":debugLineNum,
    "createLogFile":createLogFile,
    "useSSL":useSSL,
    "dataBase":false,
    "otherServers":[]
  };
  if (otherHost !== "") {
    config.otherServers[0] = otherHost;
  }
  if (useSSL == true || useSSL == "true") {
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

/* Logging */

function loadArgs() {
  if (typeof args[0] !== "undefined") {
    if (args[0] == "--help" || args[0] == "-h" || args[0] == "-H" || args[0] == "--h" || args[0] == "--H") {
      log(`You can start the server with two arguments: (config path) (logging level)`, "H");
      log(`The first argument is the relative path of the config file, eg (${logs.y}.${logs.reset}) or (${logs.y}/Config1${logs.reset})`, "H");
      log(`The second argument is the desired logging level ${logs.w+logs.dim}(A)ll${logs.reset}, ${logs.c}(D)ebug${logs.reset}, ${logs.y}(W)arnings${logs.reset}, ${logs.r}(E)rrors${logs.reset}`, "H");
      process.exit(1);
    }
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

logEvent.on('logSend', message => {
  if (typeof serverWS !== "undefined") {
    const packet = makePacket({"command":"log","data":{"log":message}});
    sendAdmins(packet);
  }
});

/* Utility */

async function folderExists(path, makeIfNotPresent = false) {
  let found = true;
  try {
    await fs.promises.access(path);
  } catch (error) {
    found = false;
    if (makeIfNotPresent) {
      log(`Folder: ${logs.y}(${path})${logs.reset} not found, creating it`, 'D');
      try {
        await fs.promises.mkdir(path, {'recursive': true});
      } catch (error) {
        log(`Couldn't create folder: ${logs.y}(${path})${logs.reset}`, 'W');
        logObj('Message', error, "W");
      }
    } else {
      log(`Folder: ${logs.y}(${path})${logs.reset} not found`, 'D');
    }
  }
  return found;
}

async function readFile(path, content) {
  try {
    await fs.promises.access(path);
    return await fs.promises.readFile(path);
  } catch (error) {
    if (typeof content === 'undefined') return;
    log(`Folder/file: ${logs.y}(${path})${logs.reset} not found, creating it`, 'D');
    try {
      const folder = path.split('.')[0];
      await fs.promises.mkdir(folder, {'recursive': true});
      await fs.promises.writeFile(path, content);
    } catch (error) {
      log(`Couldn't create folder: ${logs.y}(${path})${logs.reset}`, 'W');
      logObj('Message', error, "W");
    }
  }
}