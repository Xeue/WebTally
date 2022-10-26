
let sent = 0;

async function AJAXLoop() {
  console.log("Requesting");
  $.get("https://"+window.location.hostname+"/REST/getTally.php?all=true&AJAX=true&table=tally" + port, function(data) {
    AJAXhandle(data);
    AJAXLoop();
  });
  console.log("Sent request");
}

function AJAXhandle(data) {
  tally = JSON.parse(data);
  indicatior = $("#t_indicatior");
  console.log("--- New Message ---");
  console.log(tally);
  console.log("--- End Message ---");
  if (tally.prev == CamNum) {
    indicatior.addClass("green");
  } else {
    indicatior.removeClass("green");
  }
  if (tally.prog == CamNum) {
    indicatior.addClass("red");
  } else {
    indicatior.removeClass("red");
  }
  if (tally.switch == CamNum) {
    indicatior.addClass("orange");
  } else {
    indicatior.removeClass("orange");
  }
  if (client && sent != tally.sent) {
    $.get("https://"+window.location.hostname+"/REST/saveData.php?sent=" + tally.sent + "&table=tally" + port + "&delivered=" + Date.now(), function(data) {});
    sent = tally.sent;
  }
}

AJAXLoop();

$(document).ready(function() {
  $(document).click(function(e) {
    $trg = $(e.target);
    if ($trg.is("#settings")) {
      $("#t_chngCont").toggleClass("hidden");
    } else if ($trg.is("#t_chngPlus")) {
      CamNum++;
      updateCamNum(CamNum);
    } else if ($trg.is("#t_chngMinus")) {
      if (CamNum != 1) {
        CamNum--;
        updateCamNum(CamNum);
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
      $(".c_prog").removeClass("c_active");
      $(".c_switch").removeClass("c_switch");
      $trg.addClass("c_active");
      conn.tally(num, "prog");
    } else if ($trg.hasClass("c_prev")) {
      let num = $trg.parent().attr("id");
      $(".c_prev").removeClass("c_active");
      $trg.addClass("c_active");
      conn.tally(num, "prev");
    } else if ($trg.is("#c_cut")) {
      $prog = $(".c_prog.c_active");
      $prev = $(".c_prev.c_active");
      $prev.siblings(".c_prog").trigger("click");
      $prog.siblings(".c_prev").trigger("click");
    } else if ($trg.is("#c_auto")) {
      $prog = $(".c_prog.c_active");
      $prev = $(".c_prev.c_active");
      $prog.siblings(".c_prev").addClass("c_switch");
      $prev.siblings(".c_prog").addClass("c_switch");
      conn.tally($prev.parent().attr("id"), "switch");
      setTimeout(function(){autoTrans($prev.parent().attr("id"), $prog.parent().attr("id"))}, 1000);
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

function updateCamNum(num) {
  $("#t_chngCamNum").html(num);
  $("#t_camnum").html(num);
  if (history.pushState) {
    const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?camera=' + num;
    window.history.pushState({path:newurl},'',newurl);
  }
  $.get("https://"+window.location.hostname+"/updateTally.php?camera=" + CamNum, function(data) {
    $("#t_indicatior").attr("class", "");
    classes = JSON.parse(data);
    for (let i = 0; i < classes.length; i++) {
      $("#t_indicatior").addClass(classes[i]);
    }
  });
}

function autoTrans(prog, prev) {
  $("#"+prog).find(".c_prog").trigger("click");
  $("#"+prev).find(".c_prev").trigger("click");
  conn.tally(0, "switch");
}

let clicker = false;

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
