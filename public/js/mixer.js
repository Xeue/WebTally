/*jshint esversion: 6 */

function socketDoOpen() {
  console.log("Registering as client");
  sendData({"command":"register"});
}

function socketDoMessage(packet, header, payload, e) {
  indicatior = $("#t_indicatior");

  switch (payload.command) {
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
    default:

  }
}

socketConnect("Mixer");

$(document).ready(function() {
  $(document).click(function(e) {
    $trg = $(e.target);
    if ($trg.is("#settings")) {
      $("#t_chngCont").toggleClass("hidden");
      $trg.toggleClass("rotate");
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
