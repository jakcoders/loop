import { NextResponse } from "next/server";

/**
 * Static registry of available slash commands.
 * In a real deployment these would be extensible via a plugin table;
 * for now we ship a useful built-in set.
 */
export type SlashCommand = {
  name: string;
  description: string;
  usage?: string;
};

const COMMANDS: SlashCommand[] = [
  { name: "me", description: "Set a status that shows when people message you", usage: "/me is away" },
  { name: "shrug", description: "Append ¯\\_(ツ)_/¯ to the message", usage: "/shrug" },
  { name: "giphy", description: "Send a random GIF", usage: "/giphy cat" },
  { name: "remind", description: "Set a reminder", usage: "/remind me in 10m to check reports" },
  { name: "topic", description: "Change the channel topic", usage: "/topic New topic" },
  { name: "rename", description: "Rename a channel", usage: "/rename channel-name" },
  { name: "invite", description: "Invite someone to the channel", usage: "/invite @user" },
  { name: "leave", description: "Leave the current channel", usage: "/leave" },
  { name: "kick", description: "Remove a member (admin)", usage: "/kick @user" },
  { name: "ban", description: "Ban a user (owner/admin)", usage: "/ban @user" },
  { name: "pin", description: "Pin the latest message (or a thread)", usage: "/pin" },
  { name: "save", description: "Save a message to your 'Later' list", usage: "/save" },
  { name: "clear", description: "Clear all messages in the channel", usage: "/clear" },
  { name: "help", description: "Show this list of commands", usage: "/help" },
];

export async function GET() {
  return NextResponse.json({ items: COMMANDS });
}
