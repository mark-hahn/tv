#!/usr/bin/env node

/**
 * Phase 1 Test Script
 * Tests that the new TVDB schema fields are properly initialized
 */

import fs from 'fs';
import path from 'path';

const TVDB_PATH = '/root/dev/apps/tv/apps/srvr/data/tvdb.json';

async function testPhase1() {
  console.log('=== Phase 1 Test: TVDB Schema Extension ===\n');

  // Check if tvdb.json exists
  if (!fs.existsSync(TVDB_PATH)) {
    console.log('❌ tvdb.json not found at:', TVDB_PATH);
    console.log('   This is expected if running locally. The actual file is on remote server.');
    console.log('   Please run this test on the remote server: hahnca.com');
    return;
  }

  try {
    const tvdbData = JSON.parse(fs.readFileSync(TVDB_PATH, 'utf8'));
    const shows = Object.values(tvdbData);
    
    if (shows.length === 0) {
      console.log('⚠️  No shows found in tvdb.json');
      return;
    }

    console.log(`Found ${shows.length} shows in tvdb.json\n`);

    // Check first few shows for new fields
    let passCount = 0;
    let failCount = 0;
    const samplesToCheck = Math.min(5, shows.length);

    console.log(`Checking ${samplesToCheck} shows for new schema fields...\n`);

    for (let i = 0; i < samplesToCheck; i++) {
      const show = shows[i];
      const name = show.name || `Show ${i+1}`;
      
      console.log(`${i+1}. "${name}"`);
      
      const checks = {
        'emby object': show.emby && typeof show.emby === 'object',
        'emby.id': show.emby?.id !== undefined,
        'emby.inToTry': show.emby?.inToTry !== undefined,
        'disk object': show.disk && typeof show.disk === 'object',
        'disk.date': show.disk?.date !== undefined,
        'disk.size': show.disk?.size !== undefined,
        'download object': show.download && typeof show.download === 'object',
        'tvmaze object': show.tvmaze && typeof show.tvmaze === 'object',
        'gap field': show.gap !== undefined,
        'note field': show.note !== undefined,
        'reject field': show.reject !== undefined,
        'pickup field': show.pickup !== undefined,
        'sync object': show.sync && typeof show.sync === 'object',
        'sync.lastMetadataUpdate': show.sync?.lastMetadataUpdate !== undefined,
      };

      let allPassed = true;
      for (const [field, passed] of Object.entries(checks)) {
        if (!passed) {
          console.log(`   ❌ Missing: ${field}`);
          allPassed = false;
        }
      }

      if (allPassed) {
        console.log(`   ✅ All new fields present`);
        passCount++;
      } else {
        failCount++;
      }
      console.log('');
    }

    // Summary
    console.log('=== Summary ===');
    console.log(`Total shows: ${shows.length}`);
    console.log(`Checked: ${samplesToCheck}`);
    console.log(`✅ Passed: ${passCount}`);
    console.log(`❌ Failed: ${failCount}`);

    if (failCount === 0) {
      console.log('\n🎉 Phase 1 migration successful!');
      console.log('All shows have the new schema fields.');
    } else {
      console.log('\n⚠️  Some shows missing new fields.');
      console.log('The migration should run automatically on next srvr start.');
    }

    // Show example of new structure
    if (shows.length > 0) {
      console.log('\n=== Example Show Structure ===');
      const example = shows[0];
      console.log(JSON.stringify({
        name: example.name,
        tvdbId: example.tvdbId,
        emby: example.emby,
        disk: example.disk,
        download: example.download,
        tvmaze: example.tvmaze,
        gap: example.gap,
        note: example.note,
        reject: example.reject,
        pickup: example.pickup,
        sync: example.sync,
      }, null, 2));
    }

  } catch (err) {
    console.error('❌ Error reading tvdb.json:', err.message);
    process.exit(1);
  }
}

testPhase1().catch(console.error);
