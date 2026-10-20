export const absenceAcknowledged = (row,record) => row?.status === 'absent' && record?.state === 'acknowledged' && row?.recordVersion === record?.recordVersion;
