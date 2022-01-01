/*jshint esversion: 6 */
var connecting = 0;
var conn;
var connCount = 0;
var connNum = 1;
var currentCon;
var connectLoop;
var forceShut = 0;

var version = "4.0";
var type = "Config";
var productionID = null;

let loadTime = new Date().getTime();

let myID = "B_"+loadTime+"_"+version;

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

      if (payload.command == "config") {
        switch (payload.config) {
          case "camera":
            updateCamNum(payload.data.camera, payload.serial);
            break;
          case "identify":
            //identify(serial);
            break;
          default:
        }
      } else if (payload.command == "tally") {
        let main = payload.busses.main;
        for (var index in main) {
          if (main.hasOwnProperty(index)) {
            if (main[index].prev == true) {
              $(".s_device[data-id='"+index+"']").addClass("green");
            } else if (main[index].prev == false) {
              $(".s_device[data-id='"+index+"']").removeClass("green");
            }

            if (main[index].prog == true) {
              $(".s_device[data-id='"+index+"']").addClass("red");
            } else if (main[index].prog == false) {
              $(".s_device[data-id='"+index+"']").removeClass("red");
            }
          }
        }
      } else if (payload.command == "register" && header.type != "Config") {
        $device = $(document.getElementById(header.fromID));
        if ($device.length == 0) {
          URL = "components/config?online=true&id="+header.fromID+"&camera="+payload.data.camera+"&device="+header.type+"&version="+header.version;

          $.get(URL, function(data) {
            $("#c_cams").append(data);
          });
        }
      } else if (payload.command == "clients") {
        for (var client in payload.clients) {
          let thisData = payload.clients[client];
          if (payload.clients.hasOwnProperty(client)) {

            $device = $(document.getElementById(client));
            if ($device.length !== 0) {
              if (thisData.connected == true) {
                $device.addClass("s_online");
              } else {
                $device.removeClass("s_online");
              }
            } else {
              URL = "components/config?online="+thisData.connected+"&id="+client+"&camera="+thisData.camera+"&device="+thisData.type+"&version="+thisData.version;

              $.get(URL, function(data) {
                $("#c_cams").append(data);
              });
            }
          }
        }
      } else if (payload.command == "disconnect") {
        let serial = payload.data.ID;
        console.log(serial);
        document.getElementById(serial).remove();
      } else if (payload.command == "connection") {
        if (payload.status == 1) {
          $("#"+header.fromID).addClass("s_online");
        } else {
          $("#"+header.fromID).removeClass("s_online");
        }
      } else if (payload.command == "server") {
        console.log("adding new servers");
        for (var server in payload.servers) {
          if (payload.servers.hasOwnProperty(server)) {
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

    conn.tally = function(id, status) {
      id = id || 0;
      let main = {};
      main[id] = {};
      main[id][status] = true;
      let payload = {
        "command":"tally",
        "busses":{
          "main":main
        }
      };
      sendData(payload);
    };

    conn.untally = function(id, status) {
      id = id || 0;
      let main = {};
      main[id] = {};
      main[id][status] = false;
      let payload = {
        "command":"tally",
        "busses":{
          "main":main
        }
      };
      sendData(payload);
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
    if ($trg.is("#settings")) {
      $("#s_sort").toggleClass("hidden");
      $trg.toggleClass("rotate");
    } else if ($trg.is("#s_sortBtn")) {
      $("#c_cams").toggleClass("reverse");
    } else if ($trg.hasClass("s_camMinus") && !$trg.hasClass("m_disabled")) {
      $device = $trg.closest(".s_device");
      $camera = $device.data("id");
      $camera--;
      let payload = {};
      payload.data = {};
      payload.command = "config";
      payload.serial = $device.attr('id');
      payload.config = "camera";
      payload.data.camera = $camera;
      sendData(payload);
    } else if ($trg.hasClass("s_camPlus")) {
      $device = $trg.closest(".s_device");
      $camera = $device.data("id");
      $camera++;
      let payload = {};
      payload.data = {};
      payload.command = "config";
      payload.serial = $device.attr('id');
      payload.config = "camera";
      payload.data.camera = $camera;
      sendData(payload);
    } else if ($trg.hasClass("s_identify")) {
      $device = $trg.closest(".s_device");
      let payload = {};
      payload.command = "command";
      payload.serial = $device.attr('id');
      payload.action = "identify";
      sendData(payload);
    } else if ($trg.hasClass("s_power")) {
      $device = $trg.closest(".s_device");
      let payload = {};
      payload.command = "command";
      payload.serial = $device.attr('id');
      payload.action = "reboot";
      sendData(payload);
    } else if ($trg.hasClass("s_config")) {
      $device = $trg.closest(".s_device");
      let payload = {};
      payload.command = "command";
      payload.serial = $device.attr('id');
      payload.action = "configMode";
      sendData(payload);
    }
  });
});

function updateCamNum(camera, serial) {
  $device = $(document.getElementById(serial));
  $device.attr("data-id", camera);
  $device.prop("data-id", camera);
  $device.data("id", camera);

  $device.find(".s_camNum").html(camera);
  if (camera == 1) {
    $device.find(".s_camMinus").addClass("m_disabled");
  } else {
    $device.find(".s_camMinus").removeClass("m_disabled");
  }
}

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
