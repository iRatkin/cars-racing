#!/usr/bin/env bash
curl -s http://localhost:3000/health | python3 -m json.tool
