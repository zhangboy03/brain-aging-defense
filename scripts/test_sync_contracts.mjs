import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const hexDisplay = read('public/hexagon/index.html');
assert.match(hexDisplay, /Number\.isFinite\(lastState\.endAt\)&&\s*!lastState\._timerDone/, 'hexagon display countdown must tick from endAt, not a stale timer field');
assert.doesNotMatch(hexDisplay, /lastState\.timer\s*>\s*0/, 'hexagon display tick must not depend on the incoming timer field');
assert.match(hexDisplay, /memorize:'开始记忆'/, 'hexagon display must label memorize in Chinese');
assert.match(hexDisplay, /targetLabel\.textContent=showTarget\?'目标数'/, 'hexagon display must label target in Chinese');
assert.match(hexDisplay, /hud\.classList\.toggle\('target-center'/, 'hexagon display must center the target UI when it appears');

const gomokuCore = read('public/blind-gomoku/core.js');
const gomokuAdmin = read('public/blind-gomoku/admin.html');
const gomokuPlayer = read('public/blind-gomoku/index.html');
assert.match(gomokuCore, /const SIZE = 19/, 'blind-gomoku rules must use a larger 19-line board');
assert.match(gomokuCore, /const COLORS = \['red', 'yellow', 'blue', 'green', 'pink', 'purple'\]/, 'blind-gomoku surface color choices must exclude black and white');
assert.match(gomokuAdmin, /repeat\(19, 1fr\)/, 'blind-gomoku admin board must render 19 intersections');
assert.match(gomokuPlayer, /repeat\(19, 1fr\)/, 'blind-gomoku player board must render 19 intersections');
assert.match(gomokuPlayer, /edge-left/, 'blind-gomoku player board must render line intersections, not boxed cells');
assert.match(gomokuPlayer, /\.stone\.ghosty \{ opacity: 1; \}/, 'blind-gomoku confirmed local moves must render as solid stones');
assert.doesNotMatch(gomokuPlayer, /'#fff8'|#fff8/, 'blind-gomoku confirmed stone gradients must not use transparent highlights');
assert.ok(gomokuPlayer.indexOf('id="result"') > gomokuPlayer.indexOf('<div id="side">'), 'blind-gomoku result UI must live in the side panel, not over the board');
assert.doesNotMatch(gomokuPlayer, /#result \{[^}]*position:\s*absolute/, 'blind-gomoku result UI must not overlay the board');

const headCore = read('public/head-count/core.js');
const headAdmin = read('public/head-count/index.html');
const headPlayer = read('public/head-count/player.html');
assert.match(headCore, /function startObserve\(offsetMs\)/, 'head-count stage must support clock-aligned start offsets');
assert.match(headAdmin, /startedAt/, 'head-count snapshot/event contract must carry startedAt');
assert.match(headAdmin, /verdicts/, 'head-count snapshot must carry verdicts for reconnects');
assert.match(headPlayer, /applySnapshot/, 'head-count player must apply declarative snapshots in one path');
assert.match(headPlayer, /setVerdict\(verdictThu, snap\.verdicts\.thu/, 'head-count player must restore verdicts from state');
assert.doesNotMatch(headPlayer, /stage\.round\s*!==\s*snap\.round/, 'head-count player must not compare round object identity across JSON snapshots');

const cubeDisplay = read('public/cube-battle/index.html');
assert.match(cubeDisplay, /class="axisCorner"/, 'cube-battle display must render a row/column axis corner');
assert.match(cubeDisplay, /buildAxis/, 'cube-battle display must build visible row/column axes');

console.log('sync contract checks passed');
