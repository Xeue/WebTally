/*jshint esversion: 6 */

function socketDoOpen() {
  console.log("Registering as config controler");
  sendData({"command":"register"});
}

function socketDoMessage(packet, header, payload, e) {
  switch (payload.command) {
    case "disconnect":
      const serial = payload.data.ID;
      console.log(serial);
      document.getElementById(serial).remove();
      break;
    case "server":
      console.log("adding new servers");
      for (const server in payload.servers) {
        const thisData = payload.servers[server];
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
            URL = "components/server?address="+server;

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
      break;
    case "log":
      const $log = $("<div class='log'></div>");
      const log = payload.data.log;

      const cols = [31,32,33,34,35,36,37];
      const specials = [1,2];
      const reset = 0;
      let currentCul = 37;
      let currnetSpec = 1;

      let logArr = log.split("[");

      let output = "";

      for (let index = 0; index < logArr.length; index++) {
        const element = logArr[index];
        const num = parseInt(element.substr(0, element.indexOf('m')));
        const text = element.substring(element.indexOf('m') + 1);

        if (cols.includes(num)) {
          currentCul = num;
        } else if (specials.includes(num)) {
          currnetSpec = num;
        } else if (num == reset) {
          currentCul = 37;
          currnetSpec = 1;
        }

        const colour = getClass(currentCul);
        const special = getClass(currnetSpec);
        output += `<span class="${colour} ${special}">${text}</span>`;
      }

      $log.html(output);
      $("#serverLogs").append($log);
      break;
  }
}

socketConnect("Admin");

function getClass(num) {
  let value;
  switch (num) {
    case 31:
      value = "redLog";
      break;
    case 32:
      value = "greenLog";
      break;
    case 33:
      value = "yellowLog";
      break;
    case 34:
      value = "blueLog";
      break;
    case 35:
      value = "purpleLog";
      break;
    case 36:
      value = "cyanLog";
      break;
    case 37:
      value = "whiteLog";
      break;
    case 2:
      value = "dimLog";
      break;
    case 1:
      value = "brightLog";
      break;
  };
  return value;
}

$(document).ready(function() {
  $(document).click(function(e) {
    $trg = $(e.target);
    $srv = $trg.closest(".n_server");
    pk = $srv.attr("id");
    const args = {};
    args.pk = $srv.attr("id");

    if ($trg.hasClass("n_configDev")) {
      URL = "config";
      window.open(URL, '_blank');
    } else if ($trg.hasClass("n_configProd")) {
      URL = "productions";
      window.open(URL, '_blank');
    } else if ($trg.hasClass("n_configInpt")) {
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

let isRightDragging = false;

function ResetColumnSizes() {
	// when page resizes return to default col sizes
	let page = document.getElementById("page");
	page.style.gridTemplateColumns = "1fr 4px 0.5fr";
}

function StartRightDrag() {
	isRightDragging = true;
}

function EndDrag() {
	isRightDragging = false;
}

function OnDrag(event) {
	if(isRightDragging) {

		let page = document.getElementById("page");
		let rightcol = document.getElementById("LogsDrag");

		let rightColWidth = isRightDragging ? page.clientWidth - event.clientX : rightcol.clientWidth;

		let dragbarWidth = 4;

		let cols = [
			page.clientWidth - (2*dragbarWidth) - rightColWidth,
			dragbarWidth,
			rightColWidth
		];

		let newColDefn = cols.map(c => c.toString() + "px").join(" ");
		page.style.gridTemplateColumns = newColDefn;

		event.preventDefault()
	}
}
