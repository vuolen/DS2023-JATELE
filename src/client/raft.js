const randomTimeout = () => Math.random() * 1100 + 3000;

const raftResetTimeout = (raft) => {
  clearTimeout(raft.timeout);
  raft.timeout = setTimeout(raftElectionTimeout(raft), randomTimeout());
};

const raftElectionTimeout = (raft) => () => {
  console.log("Election timeout, promoting to candidate", raft);

  raftConvertToCandidate(raft);
};

const raftConvertToFollower = (raft, term) => {
  raft.state = "follower";
  raft.term = term;
  raft.votedFor = null;
  raft.votesReceived = 0;
  if (!raft.log || raft.log.length === 0) {
    raft.log = [""];
  }
  raft.commitIndex = 0;
  raftResetTimeout(raft);
  if (raft.heartbeatTimeout) {
    clearInterval(raft.heartbeatTimeout);
  }
};

const raftConvertToCandidate = (raft) => {
  raft.state = "candidate";
  raft.term++;
  raft.votedFor = raft.peer.id;
  raft.votesReceived = 0;
  raftResetTimeout(raft);
  if (raft.heartbeatTimeout) {
    clearInterval(raft.heartbeatTimeout);
  }
  raftVoteReceived(raft);

  Object.entries(raft.getClients()).forEach(([id, conn]) => {
    conn.send({
      type: "RAFT_REQUEST_VOTE",
      // TODO log index and term
      term: raft.term,
      candidateId: raft.peer.id,
    });
  });
};

const raftConvertToLeader = (raft) => {
  raft.state = "leader";
  raft.nextIndex = {};
  raft.matchIndex = {};
  clearTimeout(raft.timeout);
  startHeartbeat(raft);
};

const startHeartbeat = (raft) => {
  if (raft.state === "leader") {
    raft.heartbeatTimeout = setInterval(() => {
      let commitConfirmed = false;
      while (raft.commitIndex < raft.log.length - 1) {
        const n_clients = Object.keys(raft.getClients()).length + 1;
        const n_received = Object.values(raft.getClients())
          .map((client) => raft.nextIndex[client.id] || 0 > raft.commitIndex)
          .filter((x) => x);

        console.log(n_received, n_clients);
        if (n_received < n_clients / 2) {
          break;
        }

        console.log("Committing");
        raft.commitIndex++;
        commitConfirmed = true;
      }

      Object.values(raft.getClients()).forEach((client) => {
        let entries;
        if (client.lastSentIndex === undefined) {
          entries = raft.log;
          client.lastSentIndex = raft.log.length;
        } else {
          entries = commitConfirmed ? raft.log.slice(client.lastSentIndex) : [];
        }

        client.send({
          type: "RAFT_APPEND_ENTRIES",
          term: raft.term,
          leaderId: raft.peer.id,
          entries: entries,
          leaderCommit: raft.commitIndex,
          prevLogIndex: client.lastSentIndex - 1,
          lastLogIndex: raft.log.length - 1,
          lastLogTerm: raft.log[raft.log.length - 1].term,
        });

        if (commitConfirmed) {
          client.lastSentIndex = raft.log.length;
        }
      });
    }, 500);
  }
};

const raftVoteReceived = (raft) => {
  raft.votesReceived++;
  const n_clients = Object.keys(raft.getClients()).length + 1;
  if (raft.votesReceived > n_clients / 2) {
    console.log(
      "Promoting to leader",
      `${raft.votesReceived} votes out of ${n_clients}`,
      raft
    );
    raftConvertToLeader(raft);
  }
};

function createRaft(peer, getClients) {
  console.log("Creating raft client");
  const raft = { peer, getClients };
  raftConvertToFollower(raft, 0);
  return raft;
}

function handleRequestVote(raft, message) {
  // TODO, check log index and term

  console.log(`${message.sender.peer} requested vote`);

  let voteGranted = false;

  if (message.term > raft.term) {
    console.log(`New term, resetting vote`);
    raft.term = message.term;
    raft.votedFor = null;
  }

  if (
    message.term == raft.term &&
    (raft.votedFor === null || raft.votedFor === message.candidateId)
  ) {
    console.log("Voting for", message.candidateId);
    raft.votedFor = message.candidateId;
    raft.term = message.term;
    voteGranted = true;
    raftConvertToFollower(raft, message.term);
  }

  message.sender.send({
    type: "RAFT_REQUEST_VOTE_RESPONSE",
    term: raft.term,
    voteGranted,
  });
}

function handleRequestVoteResponse(raft, message) {
  if (
    message.term === raft.term &&
    raft.state === "candidate" &&
    message.voteGranted
  ) {
    raftVoteReceived(raft);
  }
}

function handleAppendEntries(raft, message) {
  if (message.term < raft.term) {
    message.sender.send({
      type: "RAFT_APPEND_ENTRIES_RESPONSE",
      term: raft.term,
      success: false,
    });
  } else {
    raftConvertToFollower(raft, message.term);
    raft.leader = message.sender;

    if (message.leaderCommit > raft.commitIndex) {
      raft.commitIndex = Math.min(message.leaderCommit, raft.log.length - 1);
    }

    if (message.prevLogIndex >= 0) {
      raft.log = raft.log.slice(0, message.prevLogIndex + 2);
    }

    raft.log.push(...message.entries);

    message.sender.send({
      type: "RAFT_APPEND_ENTRIES_RESPONSE",
      term: raft.term,
      nextIndex: raft.log.length,
      success: true,
    });
  }
  // TODO Reply false if log doesn’t contain an entry at prevLogIndex whose term matches prevLogTerm (§5.3)
}

function handleAppendEntriesResponse(raft, message) {
  if (message.term === raft.term && message.success) {
    raft.nextIndex[message.sender.id] = message.nextIndex;
  }
}

function handleMessage(raft, message) {
  if (raft.state === "leader") {
    raft.log.push({
      ...message,
      sender: message.sender.id || message.sender.peer || message.sender,
    });
  } else {
    if (raft.leader) {
      raft.leader.send({
        ...message,
        sender: undefined,
      });
    }
  }
}

function handleRaftMessage(raft, message) {
  raftResetTimeout(raft);
  const type = message.type.substring("RAFT_".length);
  if (type === "REQUEST_VOTE") {
    handleRequestVote(raft, message);
  } else if (type === "REQUEST_VOTE_RESPONSE") {
    handleRequestVoteResponse(raft, message);
  } else if (type === "APPEND_ENTRIES") {
    handleAppendEntries(raft, message);
  } else if (type === "MESSAGE") {
    handleMessage(raft, message);
  } else if (type === "APPEND_ENTRIES_RESPONSE") {
    handleAppendEntriesResponse(raft, message);
  }

  if (!type.startsWith("APPEND_ENTRIES")) {
    console.log("Raft message", type, message);
  } else if (type === "APPEND_ENTRIES" && message.entries.length !== 0) {
    console.log("Raft message", type, message);
  }
}

export { createRaft, handleRaftMessage };
