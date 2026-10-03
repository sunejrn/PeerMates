import { relations } from "drizzle-orm/relations";
import { user, account, rooms, playbackEvents, roomParticipants, session } from "./schema";

export const accountRelations = relations(account, ({one}) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id]
	}),
}));

export const userRelations = relations(user, ({many}) => ({
	accounts: many(account),
	rooms: many(rooms),
	playbackEvents: many(playbackEvents),
	roomParticipants: many(roomParticipants),
	sessions: many(session),
}));

export const roomsRelations = relations(rooms, ({one, many}) => ({
	user: one(user, {
		fields: [rooms.hostId],
		references: [user.id]
	}),
	playbackEvents: many(playbackEvents),
	roomParticipants: many(roomParticipants),
}));

export const playbackEventsRelations = relations(playbackEvents, ({one}) => ({
	room: one(rooms, {
		fields: [playbackEvents.roomId],
		references: [rooms.id]
	}),
	user: one(user, {
		fields: [playbackEvents.emittedBy],
		references: [user.id]
	}),
}));

export const roomParticipantsRelations = relations(roomParticipants, ({one}) => ({
	room: one(rooms, {
		fields: [roomParticipants.roomId],
		references: [rooms.id]
	}),
	user: one(user, {
		fields: [roomParticipants.userId],
		references: [user.id]
	}),
}));

export const sessionRelations = relations(session, ({one}) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id]
	}),
}));