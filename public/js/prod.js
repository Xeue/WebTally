/*jshint esversion: 6 */

function socketDoOpen() {
  console.log("Registering as config controler");
  sendData({"command":"register"});
}

function socketDoMessage(packet, header, payload, e) {
  switch (payload.command) {
    case "config":
      switch (payload.config) {
        case "camera":
          updateCamNum(payload.data.camera, payload.serial);
          break;
        case "identify":
          //identify(serial);
          break;
        default:
      }
      break;
    case "tally":
      let main = payload.busses.main;
      for (const index in main) {
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
      break;
    case "clients":
      for (const client in payload.clients) {
        let thisData = payload.clients[client];
        if (payload.clients.hasOwnProperty(client) && thisData.type !== "Admin" && thisData.type !== "Config") {

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
      break;
    case "disconnect":
      let serial = payload.data.ID;
      console.log(serial);
      document.getElementById(serial).remove();
      break;
    case "connection":
      if (payload.status == 1) {
        $("#"+header.fromID).addClass("s_online");
      } else {
        $("#"+header.fromID).removeClass("s_online");
      }
      break;
    case "server":
      console.log("adding new servers");
      for (const server in payload.servers) {
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
      break;
    case "register":
      if (header.type !== "Admin" && header.type !== "Config") {
        $device = $(document.getElementById(header.fromID));
        if ($device.length == 0) {
          URL = "components/config?online=true&id="+header.fromID+"&camera="+payload.data.camera+"&device="+header.type+"&version="+header.version;

          $.get(URL, function(data) {
            $("#c_cams").append(data);
          });
        }
      }
      break;
    default:
  }
}

socketConnect("Config");

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
