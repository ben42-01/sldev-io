@ECHO off
REM Windows shim for the fake codex, in the npm .cmd shim shape that src/main/launch.ts unwraps to node <script>.
SETLOCAL
SET "dp0=%~dp0"
"node" "%dp0%\codex.cjs" %*
