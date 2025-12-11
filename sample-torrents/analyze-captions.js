import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DETAIL_PAGES_DIR = path.join(__dirname, 'detail-pages');
const OUTPUT_FILE = path.join(__dirname, 'training.md');
const BAD_GROUPS_FILE = path.join(__dirname, 'bad-groups.txt');

// Track bad groups
const badGroups = [];

// Caption indicators to search for
// 
// WEIGHTS ARE MANUALLY TUNED - NOT USING GRADIENT DESCENT
// 
// The weights are chosen based on domain knowledge:
// - Strong indicators (weight 10): Patterns that appear ONLY when captions exist
//   - "Subtitle N" section headers with "====" separators
//   - "Stream Kind: Text" metadata
//   - Specific codec IDs like S_TEXT/UTF8, S_TEXT/ASS
// 
// - Medium indicators (weight 5-8): Reliable patterns but need context
//   - "Text Count: N" in file info
//   - "Codec ID: S_TEXT" in simpler formats
// 
// - Weak indicators (weight 1-3): Can appear in UI/metadata even without captions
//   - Generic words like "subtitle", "caption"
//   - Language fields (appear for audio too)
//
// Threshold is set to 10 to avoid false positives from UI text while catching
// all real caption patterns. With gradient descent you could optimize these,
// but manual tuning works well given the clear semantic differences.
//
const CAPTION_PATTERNS = [
  // Strong indicators - subtitle sections with specific formatting
  { pattern: /Subtitle\s+\d+\s*\n[=]+/gi, weight: 10, name: 'Subtitle Section Header' },
  { pattern: /Stream Kind[.\s:]*Text/gi, weight: 10, name: 'Stream Kind Text' },
  { pattern: /S_TEXT\/UTF8/gi, weight: 10, name: 'UTF8 Subtitle Codec' },
  { pattern: /S_TEXT\/ASS/gi, weight: 10, name: 'ASS Subtitle Codec' },
  { pattern: /Text Count[.\s:]*\d+/gi, weight: 8, name: 'Text Count' },
  { pattern: /Text Codecs[.\s:]*UTF-8/gi, weight: 8, name: 'Text Codecs UTF-8' },
  
  // Medium indicators - subtitle-related metadata (simpler format)
  { pattern: /Codec ID\s*:\s*S_TEXT/gi, weight: 8, name: 'Codec ID S_TEXT' },
  { pattern: /^Text<br/gmi, weight: 6, name: 'Text line marker' },
  { pattern: /Codec ID[.\s:]*S_TEXT/gi, weight: 5, name: 'S_TEXT Codec ID generic' },
  { pattern: /Language\s*:\s*English<br/gi, weight: 3, name: 'Language English (strong)' },
  { pattern: /Language[.\s:]*English/gi, weight: 1, name: 'Language English (weak)' },
  
  // Weak indicators - might be false positives
  { pattern: /\bsubtitle\b/gi, weight: 1, name: 'subtitle keyword' },
  { pattern: /\bcaption\b/gi, weight: 1, name: 'caption keyword' },
];

function loadLabels(provider) {
  const labelFile = path.join(DETAIL_PAGES_DIR, `${provider}-has-caps.txt`);
  const labels = {};
  
  if (!fs.existsSync(labelFile)) {
    console.log(`Warning: ${labelFile} not found`);
    return labels;
  }
  
  const content = fs.readFileSync(labelFile, 'utf8');
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const match = trimmed.match(/^(\d+):(t|f)$/i);
    if (match) {
      const index = parseInt(match[1]);
      const hasCaption = match[2].toLowerCase() === 't';
      labels[index] = hasCaption;
    }
  }
  
  return labels;
}

function detectCaptions(html) {
  let score = 0;
  const matches = [];
  
  for (const item of CAPTION_PATTERNS) {
    const found = html.match(item.pattern);
    if (found) {
      const itemScore = found.length * item.weight;
      score += itemScore;
      matches.push({ 
        pattern: item.name, 
        count: found.length, 
        weight: item.weight,
        score: itemScore 
      });
    }
  }
  
  // Threshold: score >= 10 means has captions
  // This filters out false positives from UI elements while catching real captions
  return { hasCaptions: score >= 10, score, matches };
}

function analyzeProvider(provider) {
  console.log(`\nAnalyzing ${provider.toUpperCase()}...`);
  
  const labels = loadLabels(provider);
  const files = fs.readdirSync(DETAIL_PAGES_DIR)
    .filter(f => f.startsWith(`${provider}-`) && f.endsWith('.html'))
    .sort((a, b) => {
      const aMatch = a.match(/^[^-]+-(\d+)-/);
      const bMatch = b.match(/^[^-]+-(\d+)-/);
      const aNum = aMatch ? parseInt(aMatch[1]) : 0;
      const bNum = bMatch ? parseInt(bMatch[1]) : 0;
      return aNum - bNum;
    });
  
  console.log(`Found ${files.length} HTML files`);
  console.log(`Found ${Object.keys(labels).length} labels`);
  
  // Split into training and test sets
  const trainSize = Math.min(25, Math.floor(files.length * 0.6));
  const trainFiles = files.slice(0, trainSize);
  const testFiles = files.slice(trainSize, trainSize + 14);
  
  console.log(`Training set: ${trainFiles.length} files`);
  console.log(`Test set: ${testFiles.length} files`);
  
  // Build group statistics from training set
  const groupStats = {};
  for (const file of trainFiles) {
    const groupMatch = file.match(/^[^-]+-\d+-(.+)\.html$/);
    const indexMatch = file.match(/^[^-]+-(\d+)-/);
    if (!groupMatch || !indexMatch) continue;
    
    const group = groupMatch[1];
    const index = parseInt(indexMatch[1]);
    const hasCaption = labels[index];
    
    if (hasCaption === undefined) continue;
    
    if (!groupStats[group]) {
      groupStats[group] = { total: 0, withCaptions: 0 };
    }
    groupStats[group].total++;
    if (hasCaption) groupStats[group].withCaptions++;
  }
  
  console.log(`Found ${Object.keys(groupStats).length} unique groups in training set`);
  console.log(`Found ${Object.keys(groupStats).length} unique groups in training set`);
  
  // Analyze training set
  const trainResults = [];
  for (const file of trainFiles) {
    const indexMatch = file.match(/^[^-]+-(\d+)-/);
    const groupMatch = file.match(/^[^-]+-\d+-(.+)\.html$/);
    if (!indexMatch || !groupMatch) continue;
    
    const index = parseInt(indexMatch[1]);
    const group = groupMatch[1];
    
    // Track unknown groups for debugging
    if (group === 'unknown') {
      const html = fs.readFileSync(path.join(DETAIL_PAGES_DIR, file), 'utf8');
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1] : file;
      badGroups.push({ file, title, phase: 'training' });
    }
    
    const actualLabel = labels[index];
    
    if (actualLabel === undefined) {
      console.log(`Warning: No label for ${file}`);
      continue;
    }
    
    const html = fs.readFileSync(path.join(DETAIL_PAGES_DIR, file), 'utf8');
    const keywordResult = detectCaptions(html);
    
    // Group-based prediction: if group has >50% captions in training, predict yes
    const groupStat = groupStats[group];
    const groupPrediction = groupStat && groupStat.withCaptions / groupStat.total > 0.5;
    
    // Combined prediction: keyword OR group
    const combinedPrediction = keywordResult.hasCaptions || groupPrediction;
    
    trainResults.push({
      file,
      index,
      group,
      actual: actualLabel,
      keywordPredicted: keywordResult.hasCaptions,
      groupPredicted: groupPrediction,
      predicted: combinedPrediction,
      score: keywordResult.score,
      correct: actualLabel === combinedPrediction
    });
  }
  
  // Analyze test set
  const testResults = [];
  for (const file of testFiles) {
    const indexMatch = file.match(/^[^-]+-(\d+)-/);
    const groupMatch = file.match(/^[^-]+-\d+-(.+)\.html$/);
    if (!indexMatch || !groupMatch) continue;
    
    const index = parseInt(indexMatch[1]);
    const group = groupMatch[1];
    
    // Track unknown groups for debugging
    if (group === 'unknown') {
      const html = fs.readFileSync(path.join(DETAIL_PAGES_DIR, file), 'utf8');
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1] : file;
      badGroups.push({ file, title, phase: 'test' });
    }
    
    const actualLabel = labels[index];
    
    if (actualLabel === undefined) {
      console.log(`Warning: No label for ${file}`);
      continue;
    }
    
    const html = fs.readFileSync(path.join(DETAIL_PAGES_DIR, file), 'utf8');
    const keywordResult = detectCaptions(html);
    
    // Group-based prediction using training data
    const groupStat = groupStats[group];
    const groupPrediction = groupStat && groupStat.withCaptions / groupStat.total > 0.5;
    
    // Combined prediction: keyword OR group
    const combinedPrediction = keywordResult.hasCaptions || groupPrediction;
    
    testResults.push({
      file,
      index,
      group,
      actual: actualLabel,
      keywordPredicted: keywordResult.hasCaptions,
      groupPredicted: groupPrediction,
      predicted: combinedPrediction,
      score: keywordResult.score,
      groupInfo: groupStat ? `${groupStat.withCaptions}/${groupStat.total}` : 'unknown',
      correct: actualLabel === combinedPrediction
    });
  }
  
  return { trainResults, testResults, groupStats };
}

function generateReport(iptResults, tlResults) {
  let report = '# Caption Detection Training Results\n\n';
  report += `Generated: ${new Date().toISOString()}\n\n`;
  
  report += '## Algorithm\n\n';
  report += '### Keyword Detection\n\n';
  report += 'Searches for weighted patterns in the HTML:\n\n';
  report += '| Pattern | Weight | Description |\n';
  report += '|---------|--------|-------------|\n';
  for (const item of CAPTION_PATTERNS) {
    report += `| ${item.name} | ${item.weight} | Strong indicator |\n`;
  }
  report += '\n**Threshold:** Score ≥ 10 indicates captions present\n\n';
  report += '### Group-Based Detection\n\n';
  report += 'Uses training data to determine if a release group typically includes captions.\n';
  report += 'If >50% of training samples for a group have captions, predict yes for that group.\n\n';
  report += '### Combined Prediction\n\n';
  report += 'Final prediction: **Keyword Match OR Group Prediction**\n\n';
  
  // Group statistics
  report += '## Group Statistics from Training Data\n\n';
  report += '### IPTorrents Groups\n\n';
  report += '| Group | Samples | With Captions | Rate |\n';
  report += '|-------|---------|---------------|------|\n';
  const iptGroupsSorted = Object.entries(iptResults.groupStats)
    .sort((a, b) => b[1].total - a[1].total);
  for (const [group, stats] of iptGroupsSorted) {
    const rate = ((stats.withCaptions / stats.total) * 100).toFixed(0);
    report += `| ${group} | ${stats.total} | ${stats.withCaptions} | ${rate}% |\n`;
  }
  
  report += '\n### TorrentLeech Groups\n\n';
  report += '| Group | Samples | With Captions | Rate |\n';
  report += '|-------|---------|---------------|------|\n';
  const tlGroupsSorted = Object.entries(tlResults.groupStats)
    .sort((a, b) => b[1].total - a[1].total);
  for (const [group, stats] of tlGroupsSorted) {
    const rate = ((stats.withCaptions / stats.total) * 100).toFixed(0);
    report += `| ${group} | ${stats.total} | ${stats.withCaptions} | ${rate}% |\n`;
  }
  
  // IPTorrents results
  report += '\n## IPTorrents Results\n\n';
  report += '### Training Set\n\n';
  const iptTrainCorrect = iptResults.trainResults.filter(r => r.correct).length;
  const iptTrainTotal = iptResults.trainResults.length;
  const iptTrainAccuracy = ((iptTrainCorrect / iptTrainTotal) * 100).toFixed(1);
  report += `Accuracy: ${iptTrainCorrect}/${iptTrainTotal} (${iptTrainAccuracy}%)\n\n`;
  
  report += '| Index | Group | Actual | Keyword | Group | Final | Score | Result |\n';
  report += '|-------|-------|--------|---------|-------|-------|-------|--------|\n';
  for (const r of iptResults.trainResults) {
    const actualStr = r.actual ? 'Yes' : 'No';
    const keywordStr = r.keywordPredicted ? 'Yes' : 'No';
    const groupStr = r.groupPredicted ? 'Yes' : 'No';
    const finalStr = r.predicted ? 'Yes' : 'No';
    const resultStr = r.correct ? '✓' : '✗';
    report += `| ${r.index} | ${r.group} | ${actualStr} | ${keywordStr} | ${groupStr} | ${finalStr} | ${r.score} | ${resultStr} |\n`;
  }
  
  report += '\n### Test Set\n\n';
  const iptTestCorrect = iptResults.testResults.filter(r => r.correct).length;
  const iptTestTotal = iptResults.testResults.length;
  const iptTestAccuracy = ((iptTestCorrect / iptTestTotal) * 100).toFixed(1);
  report += `Accuracy: ${iptTestCorrect}/${iptTestTotal} (${iptTestAccuracy}%)\n\n`;
  
  report += '| Index | Group | Actual | Keyword | Group | Final | Score | Group Info | Result |\n';
  report += '|-------|-------|--------|---------|-------|-------|-------|------------|--------|\n';
  for (const r of iptResults.testResults) {
    const actualStr = r.actual ? 'Yes' : 'No';
    const keywordStr = r.keywordPredicted ? 'Yes' : 'No';
    const groupStr = r.groupPredicted ? 'Yes' : 'No';
    const finalStr = r.predicted ? 'Yes' : 'No';
    const resultStr = r.correct ? '✓' : '✗';
    report += `| ${r.index} | ${r.group} | ${actualStr} | ${keywordStr} | ${groupStr} | ${finalStr} | ${r.score} | ${r.groupInfo} | ${resultStr} |\n`;
  }
  
  // TorrentLeech results
  report += '\n## TorrentLeech Results\n\n';
  report += '### Training Set\n\n';
  const tlTrainCorrect = tlResults.trainResults.filter(r => r.correct).length;
  const tlTrainTotal = tlResults.trainResults.length;
  const tlTrainAccuracy = ((tlTrainCorrect / tlTrainTotal) * 100).toFixed(1);
  report += `Accuracy: ${tlTrainCorrect}/${tlTrainTotal} (${tlTrainAccuracy}%)\n\n`;
  
  report += '| Index | Group | Actual | Keyword | Group | Final | Score | Result |\n';
  report += '|-------|-------|--------|---------|-------|-------|-------|--------|\n';
  for (const r of tlResults.trainResults) {
    const actualStr = r.actual ? 'Yes' : 'No';
    const keywordStr = r.keywordPredicted ? 'Yes' : 'No';
    const groupStr = r.groupPredicted ? 'Yes' : 'No';
    const finalStr = r.predicted ? 'Yes' : 'No';
    const resultStr = r.correct ? '✓' : '✗';
    report += `| ${r.index} | ${r.group} | ${actualStr} | ${keywordStr} | ${groupStr} | ${finalStr} | ${r.score} | ${resultStr} |\n`;
  }
  
  report += '\n### Test Set\n\n';
  const tlTestCorrect = tlResults.testResults.filter(r => r.correct).length;
  const tlTestTotal = tlResults.testResults.length;
  const tlTestAccuracy = ((tlTestCorrect / tlTestTotal) * 100).toFixed(1);
  report += `Accuracy: ${tlTestCorrect}/${tlTestTotal} (${tlTestAccuracy}%)\n\n`;
  
  report += '| Index | Group | Actual | Keyword | Group | Final | Score | Group Info | Result |\n';
  report += '|-------|-------|--------|---------|-------|-------|-------|------------|--------|\n';
  for (const r of tlResults.testResults) {
    const actualStr = r.actual ? 'Yes' : 'No';
    const keywordStr = r.keywordPredicted ? 'Yes' : 'No';
    const groupStr = r.groupPredicted ? 'Yes' : 'No';
    const finalStr = r.predicted ? 'Yes' : 'No';
    const resultStr = r.correct ? '✓' : '✗';
    report += `| ${r.index} | ${r.group} | ${actualStr} | ${keywordStr} | ${groupStr} | ${finalStr} | ${r.score} | ${r.groupInfo} | ${resultStr} |\n`;
  }
  
  // Overall summary
  report += '\n## Overall Summary\n\n';
  const totalTrainCorrect = iptTrainCorrect + tlTrainCorrect;
  const totalTrainTotal = iptTrainTotal + tlTrainTotal;
  const totalTrainAccuracy = ((totalTrainCorrect / totalTrainTotal) * 100).toFixed(1);
  
  const totalTestCorrect = iptTestCorrect + tlTestCorrect;
  const totalTestTotal = iptTestTotal + tlTestTotal;
  const totalTestAccuracy = ((totalTestCorrect / totalTestTotal) * 100).toFixed(1);
  
  report += `**Training Accuracy:** ${totalTrainCorrect}/${totalTrainTotal} (${totalTrainAccuracy}%)\n\n`;
  report += `**Test Accuracy:** ${totalTestCorrect}/${totalTestTotal} (${totalTestAccuracy}%)\n\n`;
  
  report += '### Prediction Method Breakdown (Test Set)\n\n';
  
  // Calculate how predictions were made
  const iptKeywordOnly = iptResults.testResults.filter(r => r.keywordPredicted && !r.groupPredicted).length;
  const iptGroupOnly = iptResults.testResults.filter(r => !r.keywordPredicted && r.groupPredicted).length;
  const iptBoth = iptResults.testResults.filter(r => r.keywordPredicted && r.groupPredicted).length;
  const iptNeither = iptResults.testResults.filter(r => !r.keywordPredicted && !r.groupPredicted).length;
  
  const tlKeywordOnly = tlResults.testResults.filter(r => r.keywordPredicted && !r.groupPredicted).length;
  const tlGroupOnly = tlResults.testResults.filter(r => !r.keywordPredicted && r.groupPredicted).length;
  const tlBoth = tlResults.testResults.filter(r => r.keywordPredicted && r.groupPredicted).length;
  const tlNeither = tlResults.testResults.filter(r => !r.keywordPredicted && !r.groupPredicted).length;
  
  report += '| Provider | Keyword Only | Group Only | Both | Neither |\n';
  report += '|----------|--------------|------------|------|----------|\n';
  report += `| IPT | ${iptKeywordOnly} | ${iptGroupOnly} | ${iptBoth} | ${iptNeither} |\n`;
  report += `| TL | ${tlKeywordOnly} | ${tlGroupOnly} | ${tlBoth} | ${tlNeither} |\n`;
  
  return report;
}

// Main execution
console.log('Caption Detection Training Analysis');
console.log('====================================');

const iptResults = analyzeProvider('ipt');
const tlResults = analyzeProvider('tl');

console.log('\nGenerating report...');
const report = generateReport(iptResults, tlResults);

fs.writeFileSync(OUTPUT_FILE, report, 'utf8');
console.log(`\nReport saved to: ${OUTPUT_FILE}`);

// Write bad groups file
if (badGroups.length > 0) {
  let badGroupsContent = '# Torrents with Unknown Groups\n\n';
  badGroupsContent += '# These files have group="unknown" which should never happen.\n';
  badGroupsContent += '# The group should be extracted from parse-torrent-title or extractGroup().\n\n';
  for (const item of badGroups) {
    badGroupsContent += `${item.file}\n`;
    badGroupsContent += `  Phase: ${item.phase}\n`;
    badGroupsContent += `  Title: ${item.title}\n\n`;
  }
  fs.writeFileSync(BAD_GROUPS_FILE, badGroupsContent, 'utf8');
  console.log(`\nFound ${badGroups.length} files with unknown groups - saved to: ${BAD_GROUPS_FILE}`);
} else {
  console.log('\nNo unknown groups found - all torrents have valid group names!');
}

// Print summary
console.log('\n=== SUMMARY ===');
const iptTrainAcc = ((iptResults.trainResults.filter(r => r.correct).length / iptResults.trainResults.length) * 100).toFixed(1);
const iptTestAcc = ((iptResults.testResults.filter(r => r.correct).length / iptResults.testResults.length) * 100).toFixed(1);
const tlTrainAcc = ((tlResults.trainResults.filter(r => r.correct).length / tlResults.trainResults.length) * 100).toFixed(1);
const tlTestAcc = ((tlResults.testResults.filter(r => r.correct).length / tlResults.testResults.length) * 100).toFixed(1);

console.log(`IPT Training: ${iptTrainAcc}%, Test: ${iptTestAcc}%`);
console.log(`TL Training: ${tlTrainAcc}%, Test: ${tlTestAcc}%`);
