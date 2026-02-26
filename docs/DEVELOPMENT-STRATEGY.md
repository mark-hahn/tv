# Safe Development Strategy - Keep App Running During Updates

## Current Setup

- **Remote server (hahnca.com)**: Runs srvr, api, down via PM2 at `/root/dev/apps/tv/`
- **Local laptop**: Development workspace at `/root/apps/tv/`, runs Vite dev
- **One server**: Can't run two versions simultaneously on remote

## Strategy: Git Worktree + Incremental Deployment

### Phase 1 (Schema Extension) - Low Risk ✅

**Status**: Already deployed via `srvr` script
**Risk**: Very low - only adds fields, doesn't change behavior
**Can run live**: Yes - backward compatible

**What to do:**

1. ✅ Already done - code changes in main branch
2. Deploy to remote: `./srvr` (copies to `/root/dev/apps/tv/`)
3. PM2 restarts srvr automatically
4. Client keeps working (doesn't use new fields yet)

**Rollback if needed:**

```bash
# Local
git revert HEAD
./srvr  # Redeploy old version

# Remote - PM2 restarts automatically
```

---

### Phase 2-7 (Major Changes) - Higher Risk

**Risk**: Medium - changes client/server behavior
**Strategy**: Use git worktree for safe testing

## Recommended Approach for Phase 2+

### Option A: Git Worktree (Recommended)

**1. Create development worktree locally:**

```bash
cd /root/apps/tv
./scripts/worktree-add.sh phase2-dev

# Now you have:
# /root/apps/tv/          (main - stable)
# /root/apps/tv-phase2-dev/  (phase2-dev - testing)
```

**2. Work in worktree:**

```bash
cd /root/apps/tv-phase2-dev

# Make Phase 2 changes
# Test with local Vite dev: cd apps/client && ./run
```

**3. Test locally before deploying:**

```bash
# In worktree, test client connects to REMOTE srvr
cd apps/client
npm run dev
# Opens localhost - uses remote hahnca.com:8091 for data
```

**4. Deploy when ready:**

```bash
# From worktree
./srvr  # Deploys worktree code to remote
# PM2 restarts, user sees new version
```

**5. If issue, rollback from main:**

```bash
# Switch back to main
cd /root/apps/tv
./srvr  # Redeploy stable version
```

**6. Merge when stable:**

```bash
cd /root/apps/tv
git merge phase2-dev
git branch -d phase2-dev
rm -rf /root/apps/tv-phase2-dev
```

---

### Option B: Feature Branches (Simpler)

**1. Create feature branch:**

```bash
cd /root/apps/tv
git checkout -b phase2-updates
```

**2. Make changes, test locally:**

```bash
# Client runs locally, connects to remote srvr
cd apps/client && ./run
```

**3. Deploy to test:**

```bash
# Deploy branch to remote
./srvr
```

**4. If issues, quick rollback:**

```bash
git checkout main
./srvr  # Redeploy stable
```

**5. When stable, merge:**

```bash
git checkout main
git merge phase2-updates
git branch -d phase2-updates
```

---

## Testing Strategy by Phase

### Phase 1 ✅ (Already done)

- **Deploy**: Live on remote now
- **Risk**: Minimal - just adds schema fields
- **Testing**: Check srvr logs, verify no errors

### Phase 2 (loadAllShows refactor)

- **Test locally first**:
  - Run local client dev
  - Points to remote srvr/data
  - See if shows load properly
- **Deploy when working**: `./srvr`
- **Rollback ready**: Keep main branch stable

### Phase 3-4 (Incremental syncs)

- **Deploy incrementally**:
  - Deploy sync functions first (no-op if not called)
  - Test they work
  - Enable timers
- **Low risk**: New functions don't break existing

### Phase 5 (Data consolidation)

- **BACKUP FIRST**:
  ```bash
  ssh hahnca.com
  cd /root/dev/apps/tv/apps/srvr/data
  tar -czf backup-$(date +%Y%m%d).tar.gz *.json
  ```
- **Deploy migration**
- **Verify**: Check logs, verify shows load
- **Rollback**: Restore backup files if needed

### Phase 6-7 (Client updates)

- **Test extensively local first**
- **Deploy**: `./srvr`
- **Watch**: Monitor client for errors

---

## Quick Reference Commands

### Deploy from current branch:

```bash
cd /root/apps/tv  # Or any worktree
./srvr             # Copies api, down, srvr to remote
```

### Rollback to previous version:

```bash
git log --oneline -5  # Find commit
git checkout <commit-hash>
./srvr                # Redeploy old version
git checkout main     # Return to latest
```

### Check what's running on remote:

```bash
ssh hahnca.com
pm2 list
pm2 logs srvr --lines 50
```

### View remote tvdb.json:

```bash
ssh hahnca.com "head -100 /root/dev/apps/tv/apps/srvr/data/tvdb.json"
```

---

## What Runs Where

**During Development:**

| Component   | Runs On | Port | What It Does         |
| ----------- | ------- | ---- | -------------------- |
| Vite Dev    | Laptop  | 5173 | Client UI - dev mode |
| srvr        | Remote  | 8091 | WebSocket/HTTP API   |
| api         | Remote  | 8092 | Download/torrent API |
| down        | Remote  | -    | Download worker      |
| Emby        | Remote  | 8096 | Media server         |
| qBittorrent | Remote  | -    | Torrent client       |

**Why this works:**

- Local client (Vite) connects to remote srvr via WebSocket
- Remote srvr has access to tvdb.json, Emby, downloads
- You see changes immediately in local browser
- No need to deploy client until ready

---

## Recommended Plan

**For Phase 2:**

1. ✅ Phase 1 already deployed and running
2. Create `phase2-updates` branch
3. Make loadAllShows changes
4. Test locally: `cd apps/client && ./run`
5. If works: `./srvr` to deploy
6. If breaks: `git checkout main && ./srvr` to rollback
7. When stable: merge to main

**For Phase 3-7:**

- Continue same pattern
- Deploy each phase when tested
- Keep main branch stable for rollback

---

## Safety Checklist

Before deploying any phase:

- [ ] Changes tested locally
- [ ] Git committed (can rollback)
- [ ] Backup remote data if Phase 5+ (data migration)
- [ ] Know how to rollback (`git checkout main && ./srvr`)
- [ ] PM2 will auto-restart after deploy

---

## Current Status

**Phase 1: ✅ Deployed**

- Schema extension complete
- Running live on remote
- Backward compatible
- No user impact

**Next: Phase 2**

- Can develop safely on branch
- Deploy when tested
- Easy rollback available

---

## My Recommendation

**For Phase 2, let's:**

1. I make changes in current workspace
2. You test with local Vite dev (connects to remote srvr)
3. When working, run `./srvr` to deploy
4. If issue, I provide rollback command immediately
5. Move to Phase 3 when stable

**No worktree needed** unless you want extra safety. Simple branch workflow is fine since:

- Changes are incremental
- Easy to rollback with git
- Client dev shows results immediately
- Deploy script is fast (< 10 seconds)

**Sound good?** I can proceed with Phase 2 in the current workspace, and you can deploy when ready.
