**Webtally v4**

This is the spiritual sucessor to my previous webtally project. Now ported over to node from php, yay!

---

## Features

As of v4 there are a whole host of new features.

1. Multiserver support **More about this bellow**
2. Local config file
3. Saves data to local files
4. Pretty terminal output and creates a log file
5. Server seperated from UI (is this a feature?)
6. Allows remote config and control of clients

---

## WIP

Features yet to be implemented

1. Local database state saving
2. Re-merge the ui into server...
3. Server management UI
4. Finish implementing busses and sources and their UI
5. Client closest connection finding

---

## Multiserver

Details of how the multiserver system works

1. Instances of the server can be pointed to each other for them to start syncing, they then act as a single server
2. In the case of a server fail clients will switch over to the next available server
3. Linked servers share connection details and states with all other clients and servers, so every connection learns of all servers