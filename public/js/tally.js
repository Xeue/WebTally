/*jshint esversion: 6 */

function socketDoOpen() {
  console.log("Registering as client");
  sendData({"command":"register","data":{"camera":CamNum}});
}

function socketDoMessage(packet, header, payload, e) {
  indicatior = $("#t_indicatior");

  switch (payload.command) {
    case "tally":
      if (typeof payload.busses.main[CamNum] !== "undefined") {
        if (payload.busses.main[CamNum].prev == true) {
          indicatior.addClass("green");
        } else if (payload.busses.main[CamNum].prev == false) {
          indicatior.removeClass("green");
        }
        if (payload.busses.main[CamNum].prog == true) {
          indicatior.addClass("red");
        } else if (payload.busses.main[CamNum].prog == false) {
          indicatior.removeClass("red");
        }

        if (indicatior.hasClass("red")) {
          $("#favicon_32").prop("href", "img/icon/Red32.png");
          $("#favicon_192").prop("href", "img/icon/Red192.png");
        } else if (indicatior.hasClass("green")) {
          $("#favicon_32").prop("href", "img/icon/Green32.png");
          $("#favicon_192").prop("href", "img/icon/Green192.png");
        } else {
          $("#favicon_32").prop("href", "img/icon/Yellow32.png");
          $("#favicon_192").prop("href", "img/icon/Yellow192.png");
        }
      }
      break;
    case "server":
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
      break;
    case "config":
      if (payload.serial == myID) {
        switch (payload.config) {
          case "camera":
            updateCamNum(payload.data.camera);
            break;
          default:
        }
      }
      break;
    case "command":
      if (payload.serial == myID) {
        switch (payload.action) {
          case "identify":
            $("#t_indicatior").addClass("identify");
            setTimeout(function(){
              $("#t_indicatior").removeClass("identify");
            }, 4000);
            break;
          default:

        }
      }
      break;
    default:

  }
}

socketConnect("Browser");

$(document).ready(function() {
  $(document).click(function(e) {
    $trg = $(e.target);
    if ($trg.is("#settings")) {
      $("#t_chngCont").toggleClass("hidden");
      $trg.toggleClass("rotate");
    } else if ($trg.is("#t_chngPlus")) {
      CamNum++;
      let payload = {};
      payload.data = {};
      payload.command = "config";
      payload.serial = myID;
      payload.config = "camera";
      payload.data.camera = CamNum;
      sendData(payload);
    } else if ($trg.is("#t_chngMinus")) {
      if (CamNum != 1) {
        CamNum--;
        let payload = {};
        payload.data = {};
        payload.command = "config";
        payload.serial = myID;
        payload.config = "camera";
        payload.data.camera = CamNum;
        sendData(payload);
      }
    }
  });
});

function updateCamNum(num) {
  CamNum = num;
  $("#t_chngCamNum").html(num);
  $("#t_camnum").html(num);
  if (history.pushState) {
    var newurl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?camera=' + num;
    window.history.pushState({path:newurl},'',newurl);
  }
}
