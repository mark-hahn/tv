const { MailtrapClient } = require('mailtrap');

const people = [
  { name: 'Mark', email: 'mark@hahnca.com' },
  { name: 'Linda', email: 'linda@hahnca.com' },
  { name: 'Cameron', email: 'camshuler@icloud.com' },
  { name: 'Wyatt', email: 'wyshuler@icloud.com' },
  { name: 'Bowie', email: 'bowshuler@icloud.com' },
  { name: 'Dana', email: 'dhahna@gmail.com' },
  { name: 'Jesse', email: 'jsamson98@gmail.com' },
  { name: 'Erica', email: 'erica.alshuler@gmail.com' },
  { name: 'Dennis', email: 'dalshuler@gmail.com' }
];

const MAILTRAP_TOKEN = '2cd4e5572bfb0060be9f60af3d0ef4b2';
const SENDER = {
  email: 'mark@hahnca.com',
  name: 'Mark Hahn'
};

const TEST_MODE = true; // Set to false to send to real emails
const TEST_EMAIL = 'mark@hahnca.com';

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createSecretSantaAssignments(people) {
  let attempts = 0;
  const maxAttempts = 1000;
  
  while (attempts < maxAttempts) {
    const givers = [...people];
    const receivers = shuffleArray([...people]);
    
    let valid = true;
    for (let i = 0; i < givers.length; i++) {
      if (givers[i].email === receivers[i].email) {
        valid = false;
        break;
      }
    }
    
    if (valid) {
      return givers.map((giver, i) => ({
        giver: giver,
        receiver: receivers[i]
      }));
    }
    
    attempts++;
  }
  
  throw new Error('Could not create valid Secret Santa assignments');
}

async function main() {
  try {
    console.log('=== Secret Santa Assignment ===\n');
    
    const assignments = createSecretSantaAssignments(people);
    
    const client = new MailtrapClient({ token: MAILTRAP_TOKEN });
    
    for (const { giver, receiver } of assignments) {
      const recipientEmail = TEST_MODE ? TEST_EMAIL : giver.email;
      
      const emailData = {
        from: SENDER,
        to: [{ email: recipientEmail }],
        subject: '🎅 Secret Santa Assignment 2025',
        text: `Hi ${giver.name},

You are the Secret Santa for: ${receiver.name}

Remember to keep it a secret! 🤫

Happy Holidays!`,
        html: `<h2>Hi ${giver.name},</h2>
<p>You are the Secret Santa for: <strong>${receiver.name}</strong></p>
<p>Remember to keep it a secret! 🤫</p>
<p>Happy Holidays!</p>`
      };
      
      try {
        await client.send(emailData);
        console.log(`✓ Email sent to ${giver.name} (${recipientEmail})`);
      } catch (error) {
        console.error(`✗ Failed to send email to ${giver.name}: ${error.message}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('\n=== All emails sent! ===');
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
