import agent from './agent.js';
import approve from './approve.js';
import baseline from './baseline.js';
import branchCmd from './branch.js';
import build from './build.js';
import config from './config.js';
import detect from './detect.js';
import discard from './discard.js';
import drop from './drop.js';
import fix from './fix.js';
import gate from './gate.js';
import hook from './hook.js';
import init from './init.js';
import key from './key.js';
import lint from './lint.js';
import log from './log.js';
import plan from './plan.js';
import protectedCmd from './protected.js';
import redteam from './redteam.js';
import render from './render.js';
import resume from './resume.js';
import review from './review.js';
import run from './run.js';
import sandbox from './sandbox.js';
import session from './session.js';
import show from './show.js';
import sessionServer from './session-server.js';
import ship from './ship.js';
import status from './status.js';
import test from './test.js';
import token from './token.js';
import trust from './trust.js';
import unpark from './unpark.js';
import version from './version.js';

// The real command list, fixed in code: a file dropped into this folder does nothing.
// Later units add their commands here, by name. `help` is added by main.js, because it
// needs the router itself.
export const COMMANDS = [agent, approve, baseline, branchCmd, build, config, detect, discard, drop, fix, gate, hook, init, key, lint, log, plan, protectedCmd, redteam, render, resume, review, run, sandbox, session, sessionServer, ship, show, status, test, token, trust, unpark, version];
