/*jshint esversion: 6 */
var connecting = 0;
var conn;
var connCount = 0;
var connNum = 1;
var currentCon;
var connectLoop;
var forceShut = 0;

var version = "4.0";
var type = "Admin";
var productionID = null;

let loadTime = new Date().getTime();

let myID = "A_"+loadTime+"_"+version;

$("main").addClass("disconnected");

function socketConnect() {
  if (connecting == 0) {
    connecting = 1;
    if (connCount > 0) {
      connNum++;
      if (connNum > servers.length) {
        connNum -= servers.length;
      }
      connCount = 0;
    }
    connCount++;
    console.log("Connecting to: wss://"+servers[connNum-1]);
    currentCon = servers[connNum-1];
    conn = new WebSocket('wss://'+servers[connNum-1]);

    conn.onopen = function(e) {
      console.log("Connection established!");
      console.log("Registering as config controler");
      connecting = 0;
      connCount = 0;
      $("main").removeClass("disconnected");
      sendData({"command":"register"});
    };

    conn.onmessage = function(e) {
      let packet = JSON.parse(e.data);
      let header = packet.header;
      let payload = packet.payload;

      if (payload.command == "disconnect") {
        let serial = payload.data.ID;
        console.log(serial);
        document.getElementById(serial).remove();
      } else if (payload.command == "server") {
        console.log("adding new servers");
        for (var server in payload.servers) {
          let thisData = payload.servers[server];
          if (payload.servers.hasOwnProperty(server) && thisData.ID !== undefined && thisData.active == true && thisData !== null) {

            $device = $(document.getElementById(thisData.ID));
            if ($device.length !== 0) {
              if (thisData.connected == true) {
                $device.addClass("n_online");
                $device.removeClass("n_offline");
              } else {
                $device.removeClass("n_online");
                $device.addClass("n_offline");
              }
            } else {
              URL = "components/server?connected="+thisData.connected+"&name="+thisData.Name+"&ID="+thisData.ID+"&address="+server+"&version="+thisData.version;

              $.get(URL, function(data) {
                $("#n_servers").append(data);
              });
            }

            if (!servers.includes(server) && payload.servers[server].active == true) {
              servers.push(server);
            }
            if (servers.includes(server) && payload.servers[server].active == false) {
              let index = servers.indexOf(server);
              if (index > -1) {
                servers.splice(index, 1);
              }
            }
          }
        }
      } else if (payload.command == "ping") {
        conn.pong();
      }
    };

    conn.onclose = function(e) {
      if (forceShut == 0) {
        console.log('Connection failed');
        setTimeout(function(){socketConnect();}, 500);
      }
      connecting = 0;
      forceShut = 0;
      $("main").addClass("disconnected");
    };

    conn.pong = function() {
      let payload = {"command":"pong"};
      sendData(payload);
    };
  }
}

socketConnect();

$(document).ready(function() {
  $(document).click(function(e) {
    $trg = $(e.target);
    $srv = $trg.closest(".n_server");
    pk = $srv.attr("id");
    var args = {};
    args.pk = $srv.attr("id");

    if ($trg.hasClass("n_configDev")) {
      port = $trg.closest(".n_server").data("port");
      URL = "config";
      window.open(URL, '_blank');
    } else if ($trg.hasClass("n_configInpt")) {
      port = $trg.closest(".n_server").data("port");
      URL = "mixer";
      window.open(URL, '_blank');
    } else if ($trg.hasClass("start") && $srv.hasClass("n_offline")) {
      REST("start",args);
    } else if ($trg.hasClass("stop") && $srv.hasClass("n_online")) {
      REST("stop",args);
    } else if ($trg.hasClass("clearState") && $srv.hasClass("n_online")) {
      sendData(
        {
          "command":"command",
          "action":"clearStates",
          "serial":$srv.attr("id")
        }
      );
    } else if ($trg.hasClass("config") && $srv.hasClass("n_online")) {
      sendData(
        {
          "command":"command",
          "action":"config",
          "serial":$srv.attr("id")
        }
      );
    } else if ($trg.hasClass("printServers") && $srv.hasClass("n_online")) {
      sendData(
        {
          "command":"command",
          "action":"printServers",
          "serial":$srv.attr("id")
        }
      );
    } else if ($trg.hasClass("printClients") && $srv.hasClass("n_online")) {
      sendData(
        {
          "command":"command",
          "action":"printClients",
          "serial":$srv.attr("id")
        }
      );
    } else if ($trg.hasClass("delete")) {
      REST("delete",args);
    } else if ($trg.is("#new")) {
      alert("Not added yet");
    }
  });
});

function makeHeader(productionID) {
  let header = {};
  header.fromID = myID;
  if (productionID !== null) {
    header.prodID = productionID;
  }
  header.timestamp = new Date().getTime();
  header.version = version;
  header.type = type;
  if (connecting == 0) {
    header.active = true;
  } else {
    header.active = false;
  }
  header.messageID = header.timestamp;
  header.recipients = [
    currentCon
  ];
  return header;
}

function sendData(payload) {
  let packet = {};
  let header = makeHeader();
  packet.header = header;
  packet.payload = payload;
  conn.send(JSON.stringify(packet));
}
