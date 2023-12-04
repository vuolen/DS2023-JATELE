const randomTimeout = () => Math.random() * 1000 + 3000;

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
  raftResetTimeout(raft);
};

const raftConvertToCandidate = (raft) => {
  raft.state = "candidate";
  raft.term++;
  raft.votedFor = raft.peer.id;
  raft.votesReceived = 0;
  raftResetTimeout(raft);
  raftVoteReceived(raft);

  Object.entries(raft.getClients()).forEach(([id, conn]) => {
    conn.send({
      type: "REQUEST_VOTE",
      // TODO log index and term
      term: raft.term,
    });
  });
};

const raftVoteReceived = (raft) => {
  raft.votesReceived++;
  const n_clients = Object.keys(raft.getClients()).length;
  if (raft.votesReceived > n_clients / 2) {
    console.log(
      "Promoting to leader",
      `${raft.votesReceived} votes out of ${n_clients}`,
      raft
    );
    raft.state = "leader";
    clearTimeout(raft.timeout);
    // TODO send heartbeat
  }
};

function createRaft(peer, getClients) {
  console.log("Creating raft client");
  const raft = { peer, getClients };
  raftConvertToFollower(raft, 0);
  return raft;
}

function handleRequestVote(raft, sender, message) {
  // TODO, check log index and term

  let voteGranted = false;

  if (
    message.term >= raft.term &&
    (raft.votedFor === null || raft.votedFor === conn.id)
  ) {
    console.log("Voting for", conn.id);
    raft.votedFor = conn.id;
    voteGranted = true;
  }

  message.sender.send({
    type: "REQUEST_VOTE_RESPONSE",
    term: raft.term,
    voteGranted,
  });
}

function handleRequestVoteResponse(raft, message) {
  if (message.term > raft.term) {
    raftConvertToFollower(message.term);
  } else if (message.voteGranted) {
    raftVoteReceived(raft);
  }
}

function handleAppendEntries(raft, sender, message) {
  if (message.term < raft.term) {
    message.sender.send({
      type: "APPEND_ENTRIES_RESPONSE",
      term: raft.term,
      success: false,
    });
  } else if (raft.state === "candidate") {
    raftConvertToFollower(message.term);
  }
  // TODO Reply false if log doesn’t contain an entry at prevLogIndex whose term matches prevLogTerm (§5.3)
}

function handleRaftMessage(raft, message) {
  const type = message.type.substring("RAFT_".length);
  if (type === "REQUEST_VOTE") {
    handleRequestVote(raft, message);
  } else if (type === "REQUEST_VOTE_RESPONSE") {
    handleRequestVoteResponse(raft, message);
  } else if (type === "APPEND_ENTRIES") {
    handleAppendEntries(raft, message);
  }
}

export { createRaft, handleRaftMessage };
