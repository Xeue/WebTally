/*jshint esversion: 6 */
var connecting = 0;
var conn;
var connCount = 0;
var connNum = 1;
var currentCon;
var connectLoop;
var forceShut = 0;

var version = "4.0";
var type = "Browser";
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
      console.log("Connection established");
      connecting = 0;
      connCount = 0;
      $("main").removeClass("disconnected");
      if (client) {
        sendData({"command":"register","data":{"camera":CamNum}});
      }
    };

    conn.onmessage = function(e) {
      let packet = JSON.parse(e.data);
      let header = packet.header;
      let payload = packet.payload;

      indicatior = $("#t_indicatior");
      if (payload.command == "tally") {
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
      } else if (payload.command == "config" && payload.serial == myID) {
        switch (payload.config) {
          case "camera":
            updateCamNum(payload.data.camera);
            break;
          default:
        }
      } else if (payload.command == "command" && payload.serial == myID) {
        switch (payload.action) {
          case "identify":
            $("#t_indicatior").addClass("identify");
            setTimeout(function(){
              $("#t_indicatior").removeClass("identify");
            }, 4000);
            break;
          default:

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
    } else if ($trg.is("#c_add")) {
      $newEl = $trg.prev().clone();
      let num = $newEl.attr("id");
      num++;
      $newEl.attr("id",num);
      $newEl.find(".c_lbl").html(num);
      $newEl.find(".c_active").removeClass("c_active");
      $newEl.insertBefore("#c_add");
    } else if ($trg.hasClass("c_prog")) {
      let num = $trg.parent().attr("id");
      let oldnum = $(".c_prog.c_active").parent().attr("id");
      $(".c_prog").removeClass("c_active");
      $(".c_switch").removeClass("c_switch");
      $trg.addClass("c_active");
      conn.tally(num, "prog");
      conn.untally(oldnum, "prog");
    } else if ($trg.hasClass("c_prev")) {
      let num = $trg.parent().attr("id");
      let oldnum = $(".c_prev.c_active").parent().attr("id");
      $(".c_prev").removeClass("c_active");
      $trg.addClass("c_active");
      conn.tally(num, "prev");
      conn.untally(oldnum, "prev");
    } else if ($trg.is("#c_cut")) {
      $prog = $(".c_prog.c_active");
      $prev = $(".c_prev.c_active");
      $prev.siblings(".c_prog").trigger("click");
      $prog.siblings(".c_prev").trigger("click");
    } else if ($trg.is("#q_conf")) {
      $prev = $(".c_prev.q_butt.q_lbl.c_active");
      $prev.siblings(".c_prog").trigger("click");
    } else if ($trg.is("#c_auto")) {
      $prog = $(".c_prog.c_active");
      $prev = $(".c_prev.c_active");
      $prog.siblings(".c_prev").addClass("c_switch");
      $prev.siblings(".c_prog").addClass("c_switch");
      conn.tally($prev.parent().attr("id"), "switch");
      setTimeout(function(){autoTrans($prev.parent().attr("id"), $prog.parent().attr("id"));}, 1000);
    } else if ($trg.is("#c_clicker")) {
      if (clicker) {
        clicker = false;
      } else {
        clicker = true;
        clickerLoop();
      }
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

function updateCamNum(num) {
  CamNum = num;
  $("#t_chngCamNum").html(num);
  $("#t_camnum").html(num);
  if (history.pushState) {
    var newurl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?camera=' + num;
    window.history.pushState({path:newurl},'',newurl);
  }
}

function autoTrans(prog, prev) {
  $("#"+prog).find(".c_prog").trigger("click");
  $("#"+prev).find(".c_prev").trigger("click");
  conn.tally(0, "switch");
}

var clicker = false;

function clickerLoop() {
  if (clicker) {
    $butts = $(".c_butt");
    rand = getRandomInt($butts.length);
    $($butts[rand]).trigger("click");
    setTimeout(function(){clickerLoop();},1000);
  }
}

function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max));
}
