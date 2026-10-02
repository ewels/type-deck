import streamDeck from "@elgato/streamdeck";

import { CycleAction } from "./actions/cycle";
import { DialPickAction } from "./actions/dial";
import { RandomPickAction } from "./actions/random";
import { TypeAction } from "./actions/type";

streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new TypeAction());
streamDeck.actions.registerAction(new CycleAction());
streamDeck.actions.registerAction(new RandomPickAction());
streamDeck.actions.registerAction(new DialPickAction());

streamDeck.connect();
