import { MailtrapClient } from 'mailtrap';

const MAILTRAP_TOKEN = '2cd4e5572bfb0060be9f60af3d0ef4b2';
const SENDER = {
  email: 'mark@hahnca.com',
  name: 'Mark Hahn'
};

export const sendEmail = async (bodyText) => {
  try {
    const client = new MailtrapClient({ token: MAILTRAP_TOKEN });
    
    const formattedBody = bodyText.replace(/~/g, '\n');
    
    const emailData = {
      from: SENDER,
      to: [{ email: 'mark@hahnca.com' }],
      subject: 'Email from TV Series',
      text: formattedBody,
      html: `<div style="white-space: pre-wrap;">${formattedBody.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
    };
    
    await client.send(emailData);
    console.log('✓ Email sent successfully');
    return 'ok';
  } catch (error) {
    console.error('✗ Failed to send email:', error.message);
    throw error;
  }
};
