import test from 'node:test';
import assert from 'node:assert/strict';
import {freeEligibility,availableStock} from '../app/uniform-event-rules.js';
test('unknown history remains pending',()=>assert.equal(freeEligibility([]),'PENDING'));
test('reserved stock is excluded',()=>assert.equal(availableStock(5,2),3));
